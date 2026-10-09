// `inertia-native run ios|android`: builds the native shell, picks or boots a
// simulator/emulator, installs and launches the app.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'

import { devCommand, findProjectRoot } from './project.mjs'
import { createPrompter } from './prompt.mjs'

export const RUN_USAGE = `Usage: npx inertia-native run <ios|android> [options]

Builds the app in ios/ or android/, installs it on a simulator, emulator or
device and launches it. Start your dev server first.
On Android it runs \`adb reverse\` for the dev server's port (and Vite's), so
the device reaches localhost on this machine.

It uses the simulator or device that's running. If several are, it asks
which one in a terminal, and stops with the list elsewhere. If none is, it
asks which one to start; outside a terminal iOS starts the newest iPhone,
and Android its only emulator.

Options:
  --device <name>   iOS: simulator name or UDID. Android: serial from \`adb devices\`
  --avd <name>      Android: emulator (AVD) to use, started if needed
  --list            List the simulators, or the devices and emulators, and exit
  -h, --help        Show this help`

// Kotlin package of the Android template; fixed by templates/CONTRACT.md.
const ANDROID_ACTIVITY = 'dev.inertianative.app.MainActivity'
const exe = (/** @type {string} */ name, /** @type {NodeJS.Platform} */ os) => (os === 'win32' ? `${name}.exe` : name)

class Failure extends Error {}
/** @param {string} message @returns {never} */
const fail = (message) => {
  throw new Failure(message)
}

/** @typedef {import('./prompt.mjs').Prompter} Prompter */

/**
 * @typedef {import('./init.mjs').IO & { capture: Capture, spawn: Spawn }} RunIO
 * @typedef {(cmd: string, args: string[]) => { ok: boolean, stdout: string, stderr: string }} Capture
 *   Runs a command and returns its output.
 * @typedef {(cmd: string, args: string[], options?: { cwd?: string, env?: Record<string, string | undefined>, background?: boolean }) => Promise<number>} Spawn
 *   Runs a command with the terminal attached and resolves with its exit code;
 *   `background` detaches it without output (it doesn't keep the CLI running)
 *   and resolves when it exits.
 */

/**
 * @param {string[]} argv
 * @param {RunIO} io
 * @returns {Promise<number>}
 */
export async function run(argv, io) {
  const { cwd, env } = io
  const out = (/** @type {string} */ line) => io.stdout.write(`${line}\n`)
  const warn = (/** @type {string} */ line) => io.stderr.write(`${line}\n`)

  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        device: { type: 'string' },
        avd: { type: 'string' },
        list: { type: 'boolean', default: false },
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

  // Asks only in a terminal, and closes before any build takes the terminal over.
  const prompter = io.prompter ?? (io.stdin.isTTY ? createPrompter(io.stdin, /** @type {NodeJS.WritableStream} */ (io.stdout)) : undefined)
  try {
    if (flags.list) {
      if (platform === 'ios') {
        xcodeDeveloperDir(io)
        out(formatSimulators(iosSimulators(listSimulators(io))))
      } else {
        const { adb, emulator } = androidTools(findProjectRoot(cwd) ?? cwd, env, io.os)
        out(formatAndroidTargets(androidDevices(adb, io), listAvds(emulator, io)))
      }
      return 0
    }

    const root = findProjectRoot(cwd) ?? fail(`No package.json in ${cwd} or any parent directory. Run this from your app's root.`)
    const marker = platform === 'ios' ? join(root, 'ios', 'App.xcodeproj') : join(root, 'android', 'gradlew')
    if (!existsSync(marker)) fail(`No ${platform}/ shell in ${root}. Create it with: npx inertia-native init ${platform}`)

    const url = bakedUrl(root, platform)
    if (url && !(await responds(url))) {
      const dev = devCommand(root)
      warn(`! Nothing answers at ${url}: start your dev server first${dev ? ` (${dev})` : ''}. Building anyway.`)
    }

    if (platform === 'ios') await runIos(root, flags.device, prompter, io, out, warn)
    else await runAndroid(root, flags, url, prompter, io, out, warn)
    return 0
  } catch (error) {
    if (!(error instanceof Failure)) throw error
    warn(`✗ ${error.message}`)
    return 1
  } finally {
    prompter?.close()
  }
}

/**
 * @param {string} root
 * @param {string | undefined} device
 * @param {Prompter | undefined} prompter
 * @param {RunIO} io
 * @param {(line: string) => void} out
 * @param {(line: string) => void} warn
 */
async function runIos(root, device, prompter, io, out, warn) {
  const { capture } = io
  const developer = xcodeDeveloperDir(io)
  const sims = iosSimulators(listSimulators(io))
  const sim = await chooseSimulator(sims, { device, prompter })
  prompter?.close()
  out(`✓ Simulator: ${sim.name} (iOS ${sim.runtime})`)
  if (sim.state !== 'Booted') {
    const booted = capture('xcrun', ['simctl', 'boot', sim.udid])
    if (!booted.ok) fail(`Couldn't boot ${sim.name}: ${booted.stderr.trim()}`)
  }
  if (!showSimulator(developer, sim.udid, io)) {
    warn(`! Couldn't open Simulator, so ${sim.name} has no window. Open Simulator (Device Hub from Xcode 27) to see the app.`)
  }

  out('› xcodebuild (the first build downloads Swift packages and takes a few minutes)')
  const derived = join('ios', 'build')
  const status = await io.spawn(
    'xcodebuild',
    ['-project', join('ios', 'App.xcodeproj'), '-scheme', 'App', '-configuration', 'Debug',
      '-destination', `id=${sim.udid}`, '-derivedDataPath', derived, '-quiet', 'build'],
    { cwd: root, env: io.env },
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
 * Opens the simulator's window: Simulator.app, or Device Hub, which replaces
 * it from Xcode 27 (in <Xcode>/Contents/Applications) and opens devices by
 * URL. The selected Xcode's app first: `open -a` may pick another Xcode's.
 * @param {string} developer the selected Xcode's Contents/Developer
 * @param {string} udid
 * @param {RunIO} io
 * @returns {boolean} whether one opened
 */
function showSimulator(developer, udid, io) {
  const simulator = join(developer, 'Applications', 'Simulator.app')
  const deviceHub = join(developer, '..', 'Applications', 'DeviceHub.app')
  const device = ['--args', '-CurrentDeviceUDID', udid]
  const url = `devices://device/open?id=${udid}`
  const attempts = existsSync(simulator)
    ? [[simulator, ...device]]
    : existsSync(deviceHub)
      ? [[url]]
      : [['-a', 'Simulator', ...device], [url]]
  return attempts.some((args) => io.capture('open', args).ok)
}

/**
 * The selected Xcode's Contents/Developer, after checking it's Xcode.
 * @param {RunIO} io
 */
function xcodeDeveloperDir({ os, capture }) {
  if (os !== 'darwin') fail('iOS apps build on macOS only (with Xcode).')
  const selected = capture('xcode-select', ['-p'])
  if (!selected.ok) fail("Xcode isn't installed. Install it from the App Store, open it once, then re-run this.")
  if (selected.stdout.includes('CommandLineTools')) {
    fail(
      'The Command Line Tools are selected instead of Xcode. Install Xcode from the App Store, then run:\n' +
        '  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer',
    )
  }
  return selected.stdout.trim()
}

/**
 * The parsed `xcrun simctl list devices available`.
 * @param {RunIO} io
 * @returns {SimctlList}
 */
function listSimulators({ capture }) {
  const list = capture('xcrun', ['simctl', 'list', 'devices', 'available', '--json'])
  if (!list.ok) fail(`Couldn't list simulators: ${list.stderr.trim()}\nOpen Xcode once so it can finish installing its components.`)
  return JSON.parse(list.stdout)
}

/**
 * The Android SDK's adb and emulator.
 * @param {string} root
 * @param {Record<string, string | undefined>} env
 * @param {NodeJS.Platform} os
 */
function androidTools(root, env, os) {
  const sdk =
    findAndroidSdk(env, root, homedir(), os) ??
    fail('Android SDK not found. Install Android Studio and open it once (it downloads the SDK), or set ANDROID_HOME to your SDK.')
  const adb = join(sdk, 'platform-tools', exe('adb', os))
  if (!existsSync(adb)) {
    fail(`No adb in ${sdk}. In Android Studio: Settings > Languages & Frameworks > Android SDK > SDK Tools, install Android SDK Platform-Tools.`)
  }
  return { sdk, adb, emulator: join(sdk, 'emulator', exe('emulator', os)) }
}

/**
 * @param {string} root
 * @param {{ device?: string, avd?: string }} flags
 * @param {string | undefined} url
 * @param {Prompter | undefined} prompter
 * @param {RunIO} io
 * @param {(line: string) => void} out
 * @param {(line: string) => void} warn
 */
async function runAndroid(root, flags, url, prompter, io, out, warn) {
  const { env, os, capture } = io
  const { sdk, adb, emulator } = androidTools(root, env, os)
  const jdk =
    findJdk(env, io) ??
    fail('No Java found (Gradle needs JDK 17 or newer). Android Studio bundles one; or install a JDK (brew install openjdk@21) and set JAVA_HOME.')
  out(`✓ Android SDK: ${sdk}`)
  out(`✓ JDK: ${jdk.home ?? 'java on PATH'}`)

  /** @type {Record<string, string | undefined>} */
  const gradleEnv = { ...env, ANDROID_HOME: sdk }
  if (jdk.home) gradleEnv.JAVA_HOME = jdk.home
  const android = join(root, 'android')
  const gradlew = os === 'win32' ? 'gradlew.bat' : './gradlew'

  const target = await chooseAndroidTarget(androidDevices(adb, io), () => listAvds(emulator, io), { ...flags, prompter })
  prompter?.close()
  /** @type {string | undefined} */
  let serial
  /** @type {Promise<string> | undefined} */
  let booting
  const stopBooting = new AbortController()
  if ('serial' in target) serial = target.serial
  else booting = startEmulator(emulator, adb, target.avd, io, out, stopBooting.signal)

  if (booting) {
    booting.catch(() => {}) // awaited below; don't crash if the build fails first
    // Build while the emulator boots.
    out(`› ${gradlew} assembleDebug (the first build downloads Gradle and dependencies)`)
    if ((await io.spawn(gradlew, ['assembleDebug'], { cwd: android, env: gradleEnv })) !== 0) {
      stopBooting.abort() // the emulator keeps booting, but the CLI exits
      fail('Gradle build failed; see the errors above.')
    }
    serial = await booting
  }
  out(`› ${gradlew} installDebug (${serial})`)
  if ((await io.spawn(gradlew, ['installDebug'], { cwd: android, env: { ...gradleEnv, ANDROID_SERIAL: serial } })) !== 0) {
    fail('Gradle build failed; see the errors above.')
  }

  // The device's localhost is the device; forward the dev server ports to this machine.
  const { ports, warning } = reversePorts(root, url)
  const forwarded = ports.filter((port) => capture(adb, ['-s', /** @type {string} */ (serial), 'reverse', `tcp:${port}`, `tcp:${port}`]).ok)
  if (forwarded.length) out(`✓ adb reverse ${forwarded.map((port) => `tcp:${port}`).join(', ')} (localhost on ${serial} reaches this machine)`)
  for (const port of ports.filter((port) => !forwarded.includes(port))) warn(`! Couldn't run adb reverse tcp:${port} tcp:${port}`)
  if (warning) warn(warning)

  const appId =
    readFileSync(join(android, 'app', 'build.gradle.kts'), 'utf8').match(/applicationId\s*=\s*"([^"]+)"/)?.[1] ??
    fail("Couldn't find applicationId in android/app/build.gradle.kts.")
  const started = capture(adb, ['-s', /** @type {string} */ (serial), 'shell', 'am', 'start', '-n', `${appId}/${ANDROID_ACTIVITY}`])
  if (!started.ok || /Error/.test(started.stdout)) fail(`Couldn't launch ${appId}: ${(started.stdout + started.stderr).trim()}`)
  out(`✓ Launched ${appId} on ${serial}`)
}

/**
 * Ports for `adb reverse`: the app's (when its URL is local) and the Vite dev
 * server's: the URL laravel-vite-plugin (public/hot) or rails-vite-plugin
 * (tmp/rails-vite.json) wrote, vite_ruby's port (config/vite.json), else
 * Vite's default 5173 for a dev server started later.
 * @param {string} root
 * @param {string | undefined} url
 * @returns {{ ports: number[], warning?: string }}
 */
export function reversePorts(root, url) {
  const ports = new Set()
  const local = (/** @type {URL | undefined} */ u) => u && ['localhost', '127.0.0.1'].includes(u.hostname)
  const port = (/** @type {URL} */ u) => Number(u.port || (u.protocol === 'https:' ? 443 : 80))
  const app = parseUrl(url)
  if (app && local(app)) ports.add(port(app))

  let warning
  const vite = parseUrl(devServerUrl(root))
  const viteRuby = readJson(join(root, 'config', 'vite.json'))
  if (vite?.hostname === '[::1]') {
    warning =
      `! Vite listens on ${vite.host} (IPv6) only, which Android can't reach: the app will show "Error loading page".\n` +
      "  Add server: { host: '127.0.0.1' } to your vite.config, restart the dev server and run this again."
  } else if (vite && local(vite)) {
    ports.add(port(vite))
  } else if (viteRuby) {
    ports.add(Number(viteRuby.development?.port ?? viteRuby.all?.port ?? 3036))
  } else if (readdirSync(root).some((file) => /^vite\.config\.[cm]?[jt]s$/.test(file))) {
    ports.add(5173)
  }
  return { ports: [...ports], warning }
}

/**
 * The running Vite dev server's URL, as written by the Laravel or Rails plugin.
 * @param {string} root
 */
function devServerUrl(root) {
  const hot = join(root, 'public', 'hot')
  if (existsSync(hot)) return readFileSync(hot, 'utf8').trim()
  const meta = readJson(join(root, 'tmp', 'rails-vite.json'))
  return typeof meta?.url === 'string' ? meta.url : undefined
}

/** @param {string} path @returns {any} */
function readJson(path) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
  } catch {
    return undefined
  }
}

/** @param {string | undefined} value */
function parseUrl(value) {
  try {
    return value ? new URL(value) : undefined
  } catch {
    return undefined
  }
}

/**
 * Starts an AVD and resolves with its serial once Android has booted.
 * @param {string} emulator
 * @param {string} adb
 * @param {string} avd
 * @param {RunIO} io
 * @param {(line: string) => void} out
 * @param {AbortSignal} signal stops waiting
 * @returns {Promise<string>}
 */
function startEmulator(emulator, adb, avd, io, out, signal) {
  out(`› Starting emulator ${avd}`)
  /** @type {string | undefined} */
  let exited
  io.spawn(emulator, ['-avd', avd], { background: true }).then((code) => (exited = `the emulator exited (code ${code})`))

  return (async () => {
    const deadline = Date.now() + 5 * 60_000
    /** @type {string | undefined} */
    let serial
    // The first check waits only for the caller to start the build.
    for (let wait = 0; Date.now() < deadline; wait = 2000) {
      await sleep(wait, undefined, { signal })
      if (exited) fail(`Couldn't start ${avd}: ${exited}. Try starting it from Android Studio's Device Manager.`)
      serial ??= adbDevices(adb, io, true).find((s) => s.startsWith('emulator-') && avdName(adb, s, io) === avd)
      if (serial && io.capture(adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed']).stdout.trim() === '1') {
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
 * @param {RunIO} io
 */
function adbDevices(adb, io, all = false) {
  return parseAdbDevices(io.capture(adb, ['devices']).stdout)
    .filter((d) => all || d.state === 'device')
    .map((d) => d.serial)
}

/**
 * @typedef {{ serial: string, state: string, model?: string, avd?: string }} AndroidDevice
 *   `state` is `device` when usable; `avd` is set for running emulators.
 */

/**
 * Everything `adb devices -l` lists, with the AVD name of each emulator.
 * @param {string} adb
 * @param {RunIO} io
 * @returns {AndroidDevice[]}
 */
function androidDevices(adb, io) {
  return parseAdbDevices(io.capture(adb, ['devices', '-l']).stdout).map((device) =>
    device.serial.startsWith('emulator-') && device.state === 'device' ? { ...device, avd: avdName(adb, device.serial, io) || undefined } : device,
  )
}

/**
 * Parses `adb devices` (or `adb devices -l`).
 * @param {string} text
 * @returns {AndroidDevice[]}
 */
export function parseAdbDevices(text) {
  return text
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state)
    .map(([serial, state, ...details]) => {
      const model = details.find((detail) => detail.startsWith('model:'))?.slice(6).replaceAll('_', ' ')
      return model ? { serial, state, model } : { serial, state }
    })
}

/** @param {string} adb @param {string} serial @param {RunIO} io */
function avdName(adb, serial, io) {
  return io.capture(adb, ['-s', serial, 'emu', 'avd', 'name']).stdout.split(/\r?\n/)[0].trim()
}

/** @param {string} emulator @param {RunIO} io */
function listAvds(emulator, io) {
  return io.capture(emulator, ['-list-avds']).stdout.split(/\r?\n/).filter((line) => line && !line.startsWith('INFO'))
}

/**
 * What to run on: a connected device, else an emulator to start. A single
 * candidate is taken; several are asked about in a terminal, otherwise it
 * fails with the list and the flag to pick one.
 * @param {AndroidDevice[]} devices
 * @param {() => string[]} avds AVD names, read only when needed
 * @param {{ device?: string, avd?: string, prompter?: Prompter }} options
 * @returns {Promise<{ serial: string } | { avd: string }>}
 */
export async function chooseAndroidTarget(devices, avds, { device, avd, prompter }) {
  const ready = devices.filter((d) => d.state === 'device')
  if (device) {
    if (ready.some((d) => d.serial === device)) return { serial: device }
    return fail(`No device ${device} connected. Connected: ${ready.map((d) => d.serial).join(', ') || 'none'}`)
  }
  if (avd) {
    const running = ready.find((d) => d.avd === avd)
    if (running) return { serial: running.serial }
    const names = avds()
    if (!names.includes(avd)) fail(`No emulator "${avd}". Emulators: ${names.join(', ') || 'none'}`)
    return { avd }
  }

  if (ready.length === 1) return { serial: ready[0].serial }
  if (ready.length > 1) {
    if (!prompter) fail(`Several devices are connected. Pick one with --device <serial>:\n${table(ready.map(deviceRow))}`)
    return { serial: (await pick(prompter, 'Several devices are connected. Which one?', ready, (d) => deviceRow(d).join('  '))).serial }
  }

  const names = avds()
  if (!names.length) fail('No device is connected and no emulator to start. In Android Studio: Device Manager > Create Virtual Device.')
  if (names.length === 1) return { avd: names[0] }
  if (!prompter) fail(`No device is connected. Pick an emulator to start with --avd <name>:\n${table(names.map((name) => [name]))}`)
  return { avd: await prompter.select('No device is connected. Which emulator should start?', names, names[0]) }
}

/** @param {AndroidDevice} device */
const deviceRow = (device) => [device.serial, device.state === 'device' ? (device.avd ?? device.model ?? '') : device.state]

/**
 * `--list` for Android.
 * @param {AndroidDevice[]} devices
 * @param {string[]} avds
 */
export function formatAndroidTargets(devices, avds) {
  const running = (/** @type {string} */ avd) => devices.find((d) => d.avd === avd)?.serial
  return [
    'Connected devices (--device <serial>):',
    devices.length ? table(devices.map(deviceRow)) : '    none',
    'Emulators (--avd <name>):',
    avds.length ? table(avds.map((avd) => [avd, running(avd) ? `running as ${running(avd)}` : ''])) : '    none',
  ].join('\n')
}

/**
 * @typedef {{ devices: Record<string, Array<{ udid: string, name: string, state: string, isAvailable?: boolean, deviceTypeIdentifier?: string }>> }} SimctlList
 * @typedef {{ udid: string, name: string, state: string, runtime: string, iphone: boolean }} Simulator
 */

/**
 * Available iOS simulators from `xcrun simctl list devices available --json`,
 * newest iOS first.
 * @param {SimctlList} list
 * @returns {Simulator[]}
 */
export function iosSimulators(list) {
  return Object.entries(list.devices)
    .map(([runtime, devices]) => ({ version: runtime.match(/SimRuntime\.iOS-([\d-]+)$/)?.[1].split('-').map(Number), devices }))
    .filter((r) => r.version)
    .sort((a, b) => compareVersions(/** @type {number[]} */ (b.version), /** @type {number[]} */ (a.version)))
    .flatMap((r) =>
      r.devices
        .filter((d) => d.isAvailable !== false)
        .map(({ udid, name, state, deviceTypeIdentifier }) => ({
          udid,
          name,
          state,
          runtime: /** @type {number[]} */ (r.version).join('.'),
          // Simulators can be renamed; the device type says what they are.
          iphone: deviceTypeIdentifier ? deviceTypeIdentifier.includes('.iPhone') : name.startsWith('iPhone'),
        })),
    )
}

/**
 * The simulator to use: `device` (name or UDID), else the booted one. Several
 * booted are asked about in a terminal, otherwise it fails with the list.
 * None booted: it asks which iPhone to start in a terminal, otherwise takes
 * the newest.
 * @param {Simulator[]} sims from iosSimulators
 * @param {{ device?: string, prompter?: Prompter }} options
 * @returns {Promise<Simulator>}
 */
export async function chooseSimulator(sims, { device, prompter }) {
  if (device) {
    const named = sims.filter((s) => s.name === device)
    return (
      sims.find((s) => s.udid === device) ??
      named.find((s) => s.state === 'Booted') ??
      named[0] ??
      fail(`No simulator "${device}". List them with: npx inertia-native run ios --list`)
    )
  }
  const booted = sims.filter((s) => s.state === 'Booted')
  if (booted.length === 1) return booted[0]
  if (booted.length > 1) {
    if (!prompter) fail(`Several simulators are booted. Pick one with --device <name or UDID>:\n${table(booted.map(simulatorRow))}`)
    return pick(prompter, 'Several simulators are booted. Which one?', booted, simulatorLabel(booted))
  }
  const iphones = sims.filter((s) => s.iphone)
  if (!iphones.length) fail('No iPhone simulator found. In Xcode: Settings > Components, install an iOS simulator.')
  return prompter ? pick(prompter, 'Which simulator should start?', iphones, simulatorLabel(iphones)) : iphones[0]
}

/** @param {Simulator} sim */
const simulatorRow = (sim) => [sim.name, `iOS ${sim.runtime}`, sim.udid]

/**
 * `iPhone 17 (iOS 26.5)`, with the UDID when that's ambiguous.
 * @param {Simulator[]} sims
 */
function simulatorLabel(sims) {
  const short = (/** @type {Simulator} */ sim) => `${sim.name} (iOS ${sim.runtime})`
  return (/** @type {Simulator} */ sim) =>
    sims.filter((other) => short(other) === short(sim)).length > 1 ? `${sim.name} (iOS ${sim.runtime}, ${sim.udid})` : short(sim)
}

/**
 * `--list` for iOS.
 * @param {Simulator[]} sims from iosSimulators
 */
export function formatSimulators(sims) {
  const booted = sims.filter((s) => s.state === 'Booted')
  const others = sims.filter((s) => s.state !== 'Booted')
  return [
    'Booted simulators (--device <name or UDID>):',
    booted.length ? table(booted.map(simulatorRow)) : '    none',
    'Available simulators:',
    others.length ? table(others.map(simulatorRow)) : '    none',
  ].join('\n')
}

/**
 * Asks to pick one of `items`, by label; the first is the default.
 * @template T
 * @param {Prompter} prompter
 * @param {string} question
 * @param {T[]} items
 * @param {(item: T) => string} label
 * @returns {Promise<T>}
 */
async function pick(prompter, question, items, label) {
  const labels = items.map(label)
  return items[labels.indexOf(await prompter.select(question, labels, labels[0]))]
}

/**
 * Rows as indented, aligned columns.
 * @param {string[][]} rows
 */
function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)))
  return rows.map((row) => `    ${row.map((cell, i) => cell.padEnd(widths[i])).join('  ')}`.trimEnd()).join('\n')
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
 * @param {RunIO} io
 * @returns {{ home?: string } | undefined}
 */
export function findJdk(env, { os, capture }) {
  const java = (/** @type {string} */ home) => existsSync(join(home, 'bin', exe('java', os)))
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
