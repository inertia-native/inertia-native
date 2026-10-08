// `inertia-native run ios|android`: builds the native shell, picks or boots a
// simulator/emulator, installs and launches the app.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { devCommand, findProjectRoot } from './project.mjs'

export const RUN_USAGE = `Usage: npx inertia-native run <ios|android> [options]

Builds the app in ios/ or android/, starts a simulator or emulator if none is
running, installs the app and launches it. Start your dev server first.

Options:
  --device <name>   iOS: simulator name or UDID (default: the booted one, else
                    the newest iPhone). Android: serial from \`adb devices\`.
  --avd <name>      Android: emulator to use, started if needed (default: the
                    connected device, else the first AVD)
  -h, --help        Show this help`

// Kotlin package of the Android template; fixed by templates/CONTRACT.md.
const ANDROID_ACTIVITY = 'dev.inertianative.app.MainActivity'
const exe = (/** @type {string} */ name) => (process.platform === 'win32' ? `${name}.exe` : name)

class Failure extends Error {}
/** @param {string} message @returns {never} */
const fail = (message) => {
  throw new Failure(message)
}

/**
 * @param {string[]} argv
 * @param {{ cwd?: string, env?: Record<string, string | undefined>, stdout?: { write(s: string): unknown }, stderr?: { write(s: string): unknown } }} io
 * @returns {Promise<number>}
 */
export async function run(argv, io) {
  const { cwd = process.cwd(), env = process.env } = io
  const out = (/** @type {string} */ line) => io.stdout?.write(`${line}\n`)
  const warn = (/** @type {string} */ line) => io.stderr?.write(`${line}\n`)

  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        device: { type: 'string' },
        avd: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    })
  } catch (error) {
    warn(/** @type {Error} */ (error).message)
    warn('Run `npx inertia-native run --help` for usage.')
    return 1
  }
  const { values: flags, positionals } = parsed
  if (flags.help) {
    out(RUN_USAGE)
    return 0
  }
  const [platform, ...rest] = positionals
  if (rest.length || (platform !== 'ios' && platform !== 'android')) {
    warn(platform ? `Unknown platform "${positionals.join(' ')}": use ios or android.` : RUN_USAGE)
    return 1
  }

  try {
    const root = findProjectRoot(cwd) ?? fail(`No package.json in ${cwd} or any parent directory. Run this from your app's root.`)
    const marker = platform === 'ios' ? join(root, 'ios', 'App.xcodeproj') : join(root, 'android', 'gradlew')
    if (!existsSync(marker)) fail(`No ${platform}/ shell in ${root}. Create it with: npx inertia-native init ${platform}`)

    const url = bakedUrl(root, platform)
    if (url && !(await responds(url))) {
      const dev = devCommand(root)
      warn(`! Nothing answers at ${url}: start your dev server first${dev ? ` (${dev})` : ''}. Building anyway.`)
    }

    if (platform === 'ios') await runIos(root, flags.device, out)
    else await runAndroid(root, env, flags, out)
    return 0
  } catch (error) {
    if (!(error instanceof Failure)) throw error
    warn(`✗ ${error.message}`)
    return 1
  }
}

/**
 * @param {string} root
 * @param {string | undefined} device
 * @param {(line: string) => void} out
 */
async function runIos(root, device, out) {
  if (process.platform !== 'darwin') fail('iOS apps build on macOS only (with Xcode).')
  const selected = capture('xcode-select', ['-p'])
  if (!selected.ok) fail("Xcode isn't installed. Install it from the App Store, open it once, then re-run this.")
  if (selected.stdout.includes('CommandLineTools')) {
    fail(
      'The Command Line Tools are selected instead of Xcode. Install Xcode from the App Store, then run:\n' +
        '  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer',
    )
  }

  const list = capture('xcrun', ['simctl', 'list', 'devices', 'available', '--json'])
  if (!list.ok) fail(`Couldn't list simulators: ${list.stderr.trim()}\nOpen Xcode once so it can finish installing its components.`)
  const sim =
    pickSimulator(JSON.parse(list.stdout), device) ??
    fail(
      device
        ? `No simulator "${device}". List them with: xcrun simctl list devices available`
        : 'No iPhone simulator found. In Xcode: Settings > Components, install an iOS simulator.',
    )
  out(`✓ Simulator: ${sim.name} (iOS ${sim.runtime})`)
  if (sim.state !== 'Booted') capture('xcrun', ['simctl', 'boot', sim.udid])
  capture('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', sim.udid])

  out('› xcodebuild (the first build downloads Swift packages and takes a few minutes)')
  const derived = join('ios', 'build')
  const status = await inherit(
    'xcodebuild',
    ['-project', join('ios', 'App.xcodeproj'), '-scheme', 'App', '-configuration', 'Debug',
      '-destination', `id=${sim.udid}`, '-derivedDataPath', derived, '-quiet', 'build'],
    root,
  )
  if (status !== 0) fail('xcodebuild failed; see the errors above.')

  const app = join(root, derived, 'Build', 'Products', 'Debug-iphonesimulator', 'App.app')
  const bundleId = capture('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(app, 'Info.plist')]).stdout.trim()
  capture('xcrun', ['simctl', 'bootstatus', sim.udid, '-b'])
  const installed = capture('xcrun', ['simctl', 'install', sim.udid, app])
  if (!installed.ok) fail(`Couldn't install on ${sim.name}: ${installed.stderr.trim()}`)
  const launched = capture('xcrun', ['simctl', 'launch', '--terminate-running-process', sim.udid, bundleId])
  if (!launched.ok) fail(`Couldn't launch ${bundleId}: ${launched.stderr.trim()}`)
  out(`✓ Launched ${bundleId} on ${sim.name}`)
}

/**
 * @param {string} root
 * @param {Record<string, string | undefined>} env
 * @param {{ device?: string, avd?: string }} flags
 * @param {(line: string) => void} out
 */
async function runAndroid(root, env, flags, out) {
  const sdk =
    findAndroidSdk(env, root) ??
    fail('Android SDK not found. Install Android Studio and open it once (it downloads the SDK), or set ANDROID_HOME to your SDK.')
  const adb = join(sdk, 'platform-tools', exe('adb'))
  if (!existsSync(adb)) {
    fail(`No adb in ${sdk}. In Android Studio: Settings > Languages & Frameworks > Android SDK > SDK Tools, install Android SDK Platform-Tools.`)
  }
  const jdk =
    findJdk(env) ??
    fail('No Java found (Gradle needs JDK 17 or newer). Android Studio bundles one; or install a JDK (brew install openjdk@21) and set JAVA_HOME.')
  out(`✓ Android SDK: ${sdk}`)
  out(`✓ JDK: ${jdk.home ?? 'java on PATH'}`)

  /** @type {Record<string, string | undefined>} */
  const gradleEnv = { ...env, ANDROID_HOME: sdk }
  if (jdk.home) gradleEnv.JAVA_HOME = jdk.home
  const android = join(root, 'android')
  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'

  const devices = adbDevices(adb)
  /** @type {string | undefined} */
  let serial
  /** @type {Promise<string> | undefined} */
  let booting
  if (flags.device) {
    serial = devices.includes(flags.device) ? flags.device : fail(`No device ${flags.device} connected. Connected: ${devices.join(', ') || 'none'}`)
  } else if (flags.avd) {
    serial = devices.find((s) => s.startsWith('emulator-') && avdName(adb, s) === flags.avd)
    if (!serial) booting = startEmulator(sdk, adb, flags.avd, out)
  } else if (devices.length) {
    serial = devices[0]
    if (devices.length > 1) out(`! Several devices connected (${devices.join(', ')}); using ${serial}. Pick one with --device.`)
  } else {
    const avds = capture(join(sdk, 'emulator', exe('emulator')), ['-list-avds']).stdout.split(/\r?\n/).filter(Boolean)
    if (!avds.length) fail('No emulator to start. In Android Studio: Device Manager > Create Virtual Device.')
    booting = startEmulator(sdk, adb, avds[0], out)
  }

  if (booting) {
    booting.catch(() => {}) // awaited below; don't crash if the build fails first
    // Build while the emulator boots.
    out(`› ${gradlew} assembleDebug (the first build downloads Gradle and dependencies)`)
    if ((await inherit(gradlew, ['assembleDebug'], android, gradleEnv)) !== 0) fail('Gradle build failed; see the errors above.')
    serial = await booting
  }
  out(`› ${gradlew} installDebug (${serial})`)
  if ((await inherit(gradlew, ['installDebug'], android, { ...gradleEnv, ANDROID_SERIAL: serial })) !== 0) {
    fail('Gradle build failed; see the errors above.')
  }

  const appId =
    readFileSync(join(android, 'app', 'build.gradle.kts'), 'utf8').match(/applicationId\s*=\s*"([^"]+)"/)?.[1] ??
    fail("Couldn't find applicationId in android/app/build.gradle.kts.")
  const started = capture(adb, ['-s', /** @type {string} */ (serial), 'shell', 'am', 'start', '-n', `${appId}/${ANDROID_ACTIVITY}`])
  if (!started.ok || /Error/.test(started.stdout)) fail(`Couldn't launch ${appId}: ${(started.stdout + started.stderr).trim()}`)
  out(`✓ Launched ${appId} on ${serial}`)
}

/**
 * Starts an AVD and resolves with its serial once Android has booted.
 * @param {string} sdk
 * @param {string} adb
 * @param {string} avd
 * @param {(line: string) => void} out
 * @returns {Promise<string>}
 */
function startEmulator(sdk, adb, avd, out) {
  out(`› Starting emulator ${avd}`)
  const child = spawn(join(sdk, 'emulator', exe('emulator')), ['-avd', avd], { detached: true, stdio: 'ignore' })
  /** @type {string | undefined} */
  let exited
  child.on('exit', (code) => (exited = `the emulator exited (code ${code})`))
  child.on('error', (error) => (exited = error.message))
  child.unref()

  return (async () => {
    const deadline = Date.now() + 5 * 60_000
    /** @type {string | undefined} */
    let serial
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      if (exited) fail(`Couldn't start ${avd}: ${exited}. Try starting it from Android Studio's Device Manager.`)
      serial ??= adbDevices(adb, true).find((s) => s.startsWith('emulator-') && avdName(adb, s) === avd)
      if (serial && capture(adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed']).stdout.trim() === '1') {
        out(`✓ Emulator ${avd} booted (${serial})`)
        return serial
      }
    }
    return fail(`${avd} didn't finish booting in 5 minutes.`)
  })()
}

/**
 * Serials of connected devices (`all` includes offline ones).
 * @param {string} adb
 */
function adbDevices(adb, all = false) {
  return parseAdbDevices(capture(adb, ['devices']).stdout)
    .filter((d) => all || d.state === 'device')
    .map((d) => d.serial)
}

/** @param {string} text */
export function parseAdbDevices(text) {
  return text
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state)
    .map(([serial, state]) => ({ serial, state }))
}

/** @param {string} adb @param {string} serial */
function avdName(adb, serial) {
  return capture(adb, ['-s', serial, 'emu', 'avd', 'name']).stdout.split(/\r?\n/)[0].trim()
}

/**
 * The simulator to use: `wanted` (name or UDID), else the booted one, else
 * the first iPhone of the newest iOS runtime.
 * @param {{ devices: Record<string, Array<{ udid: string, name: string, state: string, isAvailable?: boolean }>> }} list
 * @param {string} [wanted]
 */
export function pickSimulator(list, wanted) {
  const sims = Object.entries(list.devices)
    .map(([runtime, devices]) => ({ version: runtime.match(/SimRuntime\.iOS-([\d-]+)$/)?.[1].split('-').map(Number), devices }))
    .filter((r) => r.version)
    .sort((a, b) => compareVersions(/** @type {number[]} */ (b.version), /** @type {number[]} */ (a.version)))
    .flatMap((r) => r.devices.filter((d) => d.isAvailable !== false).map((d) => ({ ...d, runtime: /** @type {number[]} */ (r.version).join('.') })))
  const booted = (/** @type {typeof sims} */ list) => list.find((s) => s.state === 'Booted') ?? list[0]

  if (wanted) return sims.find((s) => s.udid === wanted) ?? booted(sims.filter((s) => s.name === wanted))
  return (
    sims.find((s) => s.state === 'Booted' && s.name.startsWith('iPhone')) ??
    sims.find((s) => s.state === 'Booted') ??
    sims.find((s) => s.name.startsWith('iPhone'))
  )
}

/** @param {number[]} a @param {number[]} b */
function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0)
  }
  return 0
}

/**
 * The URL a generated shell loads.
 * @param {string} root
 * @param {'ios' | 'android'} platform
 */
export function bakedUrl(root, platform) {
  const [file, pattern] =
    platform === 'ios'
      ? [join(root, 'ios', 'App', 'AppConfig.swift'), /URL\(string:\s*"([^"]+)"\)/]
      : [join(root, 'android', 'app', 'build.gradle.kts'), /"BASE_URL",\s*"\\"([^"\\]+)\\""/]
  return existsSync(file) ? readFileSync(file, 'utf8').match(pattern)?.[1] : undefined
}

/** @param {string} url */
async function responds(url) {
  try {
    await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(3000) })
    return true
  } catch {
    return false
  }
}

/**
 * The Android SDK: ANDROID_HOME, ANDROID_SDK_ROOT, android/local.properties,
 * then where Android Studio puts it.
 * @param {Record<string, string | undefined>} env
 * @param {string} root
 * @param {string} [home]
 * @param {NodeJS.Platform} [os]
 */
export function findAndroidSdk(env, root, home = homedir(), os = process.platform) {
  const properties = join(root, 'android', 'local.properties')
  const fromProperties = existsSync(properties)
    ? readFileSync(properties, 'utf8')
        .match(/^sdk\.dir\s*=\s*(.+)$/m)?.[1]
        .trim()
        .replace(/\\(.)/g, '$1')
    : undefined
  const candidates = [
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    fromProperties,
    os === 'darwin' ? join(home, 'Library', 'Android', 'sdk') : undefined,
    os === 'linux' ? join(home, 'Android', 'Sdk') : undefined,
    os === 'win32' && env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Android', 'Sdk') : undefined,
  ]
  return candidates.find((dir) => dir && existsSync(dir) && statSync(dir).isDirectory())
}

/**
 * A JDK for Gradle: JAVA_HOME, macOS's java_home, Android Studio's bundled
 * JDK, Homebrew's openjdk, then `java` on PATH.
 * @param {Record<string, string | undefined>} env
 * @param {NodeJS.Platform} [os]
 * @returns {{ home?: string } | undefined}
 */
export function findJdk(env, os = process.platform) {
  const java = (/** @type {string} */ home) => existsSync(join(home, 'bin', exe('java')))
  if (env.JAVA_HOME && java(env.JAVA_HOME)) return { home: env.JAVA_HOME }
  if (os === 'darwin') {
    const found = capture('/usr/libexec/java_home', ['-v', '17+'])
    if (found.ok && found.stdout.trim()) return { home: found.stdout.trim() }
  }
  const home = homedir()
  const candidates = {
    darwin: [
      '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
      join(home, 'Applications', 'Android Studio.app', 'Contents', 'jbr', 'Contents', 'Home'),
      ...['/opt/homebrew/opt', '/usr/local/opt'].flatMap((prefix) =>
        ['openjdk@21', 'openjdk', 'openjdk@17'].map((jdk) => `${prefix}/${jdk}/libexec/openjdk.jdk/Contents/Home`),
      ),
    ],
    linux: ['/opt/android-studio/jbr', join(home, 'android-studio', 'jbr'), '/snap/android-studio/current/jbr'],
    win32: ['C:\\Program Files\\Android\\Android Studio\\jbr'],
  }[/** @type {'darwin' | 'linux' | 'win32'} */ (os)]
  const bundled = candidates?.find(java)
  if (bundled) return { home: bundled }
  return capture('java', ['-version']).ok ? {} : undefined
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptions} [options]
 */
function capture(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...options })
  return { ok: result.status === 0, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? result.error?.message ?? '') }
}

/**
 * Runs a command with the terminal attached; resolves with its exit code.
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} cwd
 * @param {Record<string, string | undefined>} [env]
 * @returns {Promise<number>}
 */
function inherit(cmd, args, cwd, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' })
    child.on('error', () => resolve(127))
    child.on('exit', (code) => resolve(code ?? 1))
  })
}
