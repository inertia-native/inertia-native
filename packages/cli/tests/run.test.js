import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { main } from '../bin/cli.mjs'
import {
  bakedUrl,
  chooseAndroidTarget,
  chooseSimulator,
  findAndroidSdk,
  findJdk,
  formatAndroidTargets,
  formatSimulators,
  iosSimulators,
  parseAdbDevices,
  reversePorts,
} from '../bin/run.mjs'

let tmp
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'inertia-native-run-'))
  writeFileSync(join(tmp, 'package.json'), '{}')
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

/**
 * Runs the CLI. `captures` and `spawns` script the processes it starts, by
 * command line (the command, or an absolute one's basename, then its
 * arguments): a result, or a function returning one. `calls` lists the
 * command lines in order, spawns with a `$ ` in front.
 */
async function cli(args, { os = 'darwin', env = {}, captures = {}, spawns = {} } = {}) {
  let stdout = ''
  let stderr = ''
  const calls = []
  const answer = (table, line, logged, ...rest) => {
    calls.push(logged)
    if (!(line in table)) throw new Error(`Unexpected command: ${line}`)
    return typeof table[line] === 'function' ? table[line](...rest) : table[line]
  }
  const line = (cmd, args) => [isAbsolute(cmd) ? basename(cmd) : cmd, ...args].join(' ')
  const code = await main(args, {
    cwd: tmp,
    env,
    os,
    stdin: /** @type {any} */ ({ isTTY: false }),
    stdout: { write: (s) => (stdout += s) },
    stderr: { write: (s) => (stderr += s) },
    exec: () => 0,
    capture: (cmd, args) => ({ ok: true, stdout: '', stderr: '', ...answer(captures, line(cmd, args), line(cmd, args)) }),
    spawn: async (cmd, args, options) => answer(spawns, line(cmd, args), `$ ${line(cmd, args)}`, options),
  })
  return { code, stdout, stderr, calls }
}

/** A file in tmp. */
function file(path, content = '') {
  mkdirSync(join(tmp, path, '..'), { recursive: true })
  writeFileSync(join(tmp, path), content)
  return join(tmp, path)
}

const sim = (name, udid, state = 'Shutdown') => ({ name, udid, state, isAvailable: true })

/** Scripted picker: records each question and answers with `answer(choices)` (default: the default). */
function fakePrompter(answer = (choices, fallback) => fallback) {
  const asked = []
  return {
    asked,
    async select(label, choices, fallback) {
      asked.push({ label, choices, fallback })
      return answer(choices, fallback)
    },
    async text() {
      throw new Error('unexpected text prompt')
    },
    async confirm() {
      throw new Error('unexpected confirm prompt')
    },
    close() {},
  }
}

const runtimes = {
  'com.apple.CoreSimulator.SimRuntime.iOS-18-2': [sim('iPhone 16', 'old-16'), sim('iPad Air', 'old-ipad')],
  'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [sim('iPad Pro', 'new-ipad'), sim('iPhone 17 Pro', 'new-17p'), sim('iPhone 17', 'new-17')],
  'com.apple.CoreSimulator.SimRuntime.iOS-26-10': [],
  'com.apple.CoreSimulator.SimRuntime.watchOS-26-0': [sim('Apple Watch', 'watch')],
}
/** iosSimulators of `runtimes`, with the given UDIDs booted. */
const sims = (...booted) => {
  const list = structuredClone({ devices: runtimes })
  for (const devices of Object.values(list.devices)) for (const d of devices) if (booted.includes(d.udid)) d.state = 'Booted'
  return iosSimulators(list)
}

describe('iosSimulators', () => {
  it('lists available iOS simulators, newest runtime first', () => {
    expect(sims().map((s) => `${s.udid} ${s.runtime}`)).toEqual(['new-ipad 26.5', 'new-17p 26.5', 'new-17 26.5', 'old-16 18.2', 'old-ipad 18.2'])
    const unavailable = { devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [{ ...sim('iPhone 17', 'x'), isAvailable: false }, sim('iPad', 'y')] } }
    expect(iosSimulators(unavailable).map((s) => s.udid)).toEqual(['y'])
  })
})

describe('chooseSimulator', () => {
  it('takes --device by UDID or by name (booted first, then newest runtime)', async () => {
    expect((await chooseSimulator(sims(), { device: 'old-16' })).udid).toBe('old-16')
    expect((await chooseSimulator(sims(), { device: 'iPad Air' })).udid).toBe('old-ipad')
    const twice = iosSimulators({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-18-2': [sim('Mine', 'a', 'Booted')],
        'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [sim('Mine', 'b')],
      },
    })
    expect((await chooseSimulator(twice, { device: 'Mine' })).udid).toBe('a')
    for (const s of twice) s.state = 'Shutdown'
    expect((await chooseSimulator(twice, { device: 'Mine' })).udid).toBe('b')
    await expect(chooseSimulator(sims(), { device: 'iPhone 99' })).rejects.toThrow('No simulator "iPhone 99". List them with: npx inertia-native run ios --list')
  })

  it('uses the one booted simulator, iPad or not, without asking', async () => {
    const prompter = fakePrompter()
    expect((await chooseSimulator(sims('old-ipad'), { prompter })).udid).toBe('old-ipad')
    expect((await chooseSimulator(sims('old-16'), {})).udid).toBe('old-16')
    expect(prompter.asked).toEqual([])
  })

  it('asks which of several booted simulators in a terminal', async () => {
    const prompter = fakePrompter((choices) => choices[1])
    expect((await chooseSimulator(sims('old-16', 'new-17'), { prompter })).udid).toBe('old-16')
    expect(prompter.asked).toEqual([
      { label: 'Several simulators are booted. Which one?', choices: ['iPhone 17 (iOS 26.5)', 'iPhone 16 (iOS 18.2)'], fallback: 'iPhone 17 (iOS 26.5)' },
    ])
  })

  it('fails with the list and the --device hint for several booted without a terminal', async () => {
    await expect(chooseSimulator(sims('old-16', 'new-17'), {})).rejects.toThrow(
      'Several simulators are booted. Pick one with --device <name or UDID>:\n' +
        '    iPhone 17  iOS 26.5  new-17\n' +
        '    iPhone 16  iOS 18.2  old-16',
    )
  })

  it('asks which iPhone to start in a terminal when none is booted, newest first', async () => {
    const prompter = fakePrompter()
    expect((await chooseSimulator(sims(), { prompter })).udid).toBe('new-17p')
    expect(prompter.asked).toEqual([
      {
        label: 'Which simulator should start?',
        choices: ['iPhone 17 Pro (iOS 26.5)', 'iPhone 17 (iOS 26.5)', 'iPhone 16 (iOS 18.2)'],
        fallback: 'iPhone 17 Pro (iOS 26.5)',
      },
    ])
  })

  it('takes the newest iPhone without a terminal when none is booted', async () => {
    expect((await chooseSimulator(sims(), {})).udid).toBe('new-17p')
  })

  it('adds the UDID to labels that would be ambiguous', async () => {
    const same = iosSimulators({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-26-4': [sim('iPhone 17', 'a')],
        'com.apple.CoreSimulator.SimRuntime.iOS-26-4-1': [sim('iPhone 17', 'b')],
        'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [sim('iPhone 17', 'c')],
      },
    })
    same[0].runtime = same[1].runtime = '26.4'
    const prompter = fakePrompter((choices) => choices[1])
    expect((await chooseSimulator(same, { prompter })).udid).toBe('a')
    expect(prompter.asked[0].choices).toEqual(['iPhone 17 (iOS 26.4, b)', 'iPhone 17 (iOS 26.4, a)', 'iPhone 17 (iOS 26.0)'])
  })

  it('tells iPhones by device type, so renamed ones count', async () => {
    const renamed = iosSimulators({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
          { ...sim('iPhone-ish iPad', 'ipad'), deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPad-Air-11-inch-M3' },
          { ...sim('My phone', 'mine'), deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro' },
        ],
      },
    })
    expect((await chooseSimulator(renamed, {})).udid).toBe('mine')
  })

  it('fails without any iPhone', async () => {
    const ipads = iosSimulators({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [sim('iPad', 'y')] } })
    await expect(chooseSimulator(ipads, { prompter: fakePrompter() })).rejects.toThrow('No iPhone simulator found.')
  })
})

it('lists simulators for --list', () => {
  expect(formatSimulators(sims('new-17'))).toBe(`Booted simulators (--device <name or UDID>):
    iPhone 17  iOS 26.5  new-17
Available simulators:
    iPad Pro       iOS 26.5  new-ipad
    iPhone 17 Pro  iOS 26.5  new-17p
    iPhone 16      iOS 18.2  old-16
    iPad Air       iOS 18.2  old-ipad`)
  expect(formatSimulators([])).toBe('Booted simulators (--device <name or UDID>):\n    none\nAvailable simulators:\n    none')
})

it('parses adb devices, with models from adb devices -l', () => {
  const text = 'List of devices attached\nemulator-5554\tdevice\nR58M\tunauthorized\nemulator-5556\toffline\n\n'
  expect(parseAdbDevices(text)).toEqual([
    { serial: 'emulator-5554', state: 'device' },
    { serial: 'R58M', state: 'unauthorized' },
    { serial: 'emulator-5556', state: 'offline' },
  ])
  const long = 'List of devices attached\nemulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1\n' +
    '1A2B3C                 device usb:1-1 product:panther model:Pixel_7 device:panther transport_id:2\n'
  expect(parseAdbDevices(long)).toEqual([
    { serial: 'emulator-5554', state: 'device', model: 'sdk gphone64 arm64' },
    { serial: '1A2B3C', state: 'device', model: 'Pixel 7' },
  ])
})

describe('chooseAndroidTarget', () => {
  const emu = (serial, avd) => ({ serial, state: 'device', avd })
  const phone = { serial: '1A2B3C', state: 'device', model: 'Pixel 7' }
  const unauthorized = { serial: 'R58M', state: 'unauthorized' }
  const noAvds = () => {
    throw new Error('AVDs read without need')
  }

  it('uses the one connected device without asking or reading AVDs', async () => {
    const prompter = fakePrompter()
    expect(await chooseAndroidTarget([emu('emulator-5554', 'pixel'), unauthorized], noAvds, { prompter })).toEqual({ serial: 'emulator-5554' })
    expect(await chooseAndroidTarget([phone], noAvds, {})).toEqual({ serial: '1A2B3C' })
    expect(prompter.asked).toEqual([])
  })

  it('asks which of several connected devices in a terminal', async () => {
    const prompter = fakePrompter((choices) => choices[1])
    expect(await chooseAndroidTarget([emu('emulator-5554', 'pixel'), phone, unauthorized], noAvds, { prompter })).toEqual({ serial: '1A2B3C' })
    expect(prompter.asked).toEqual([
      { label: 'Several devices are connected. Which one?', choices: ['emulator-5554  pixel', '1A2B3C  Pixel 7'], fallback: 'emulator-5554  pixel' },
    ])
  })

  it('fails with the list and the --device hint for several devices without a terminal', async () => {
    await expect(chooseAndroidTarget([emu('emulator-5554', 'pixel'), phone], noAvds, {})).rejects.toThrow(
      'Several devices are connected. Pick one with --device <serial>:\n    emulator-5554  pixel\n    1A2B3C         Pixel 7',
    )
  })

  it('starts the only AVD when nothing is connected, without asking', async () => {
    const prompter = fakePrompter()
    expect(await chooseAndroidTarget([unauthorized], () => ['pixel'], { prompter })).toEqual({ avd: 'pixel' })
    expect(await chooseAndroidTarget([], () => ['pixel'], {})).toEqual({ avd: 'pixel' })
    expect(prompter.asked).toEqual([])
  })

  it('asks which of several AVDs to start in a terminal', async () => {
    const prompter = fakePrompter()
    expect(await chooseAndroidTarget([], () => ['pixel', 'tablet'], { prompter })).toEqual({ avd: 'pixel' })
    expect(prompter.asked).toEqual([{ label: 'No device is connected. Which emulator should start?', choices: ['pixel', 'tablet'], fallback: 'pixel' }])
  })

  it('fails with the AVDs and the --avd hint without a terminal', async () => {
    await expect(chooseAndroidTarget([], () => ['pixel', 'tablet'], {})).rejects.toThrow(
      'No device is connected. Pick an emulator to start with --avd <name>:\n    pixel\n    tablet',
    )
  })

  it('fails when there is nothing to run on', async () => {
    await expect(chooseAndroidTarget([unauthorized], () => [], { prompter: fakePrompter() })).rejects.toThrow(
      'No device is connected and no emulator to start. In Android Studio: Device Manager > Create Virtual Device.',
    )
  })

  it('takes --device among connected devices', async () => {
    const devices = [emu('emulator-5554', 'pixel'), phone, unauthorized]
    expect(await chooseAndroidTarget(devices, noAvds, { device: '1A2B3C' })).toEqual({ serial: '1A2B3C' })
    await expect(chooseAndroidTarget(devices, noAvds, { device: 'R58M' })).rejects.toThrow('No device R58M connected. Connected: emulator-5554, 1A2B3C')
  })

  it('takes --avd: its serial when running, else starts it', async () => {
    const devices = [emu('emulator-5554', 'pixel'), emu('emulator-5556', 'tablet')]
    expect(await chooseAndroidTarget(devices, noAvds, { avd: 'tablet' })).toEqual({ serial: 'emulator-5556' })
    expect(await chooseAndroidTarget(devices, () => ['pixel', 'tablet', 'tv'], { avd: 'tv' })).toEqual({ avd: 'tv' })
    await expect(chooseAndroidTarget(devices, () => ['pixel', 'tablet'], { avd: 'watch' })).rejects.toThrow('No emulator "watch". Emulators: pixel, tablet')
  })
})

it('lists devices and emulators for --list', () => {
  const devices = [{ serial: 'emulator-5554', state: 'device', avd: 'pixel' }, { serial: 'R58M', state: 'unauthorized' }]
  expect(formatAndroidTargets(devices, ['pixel', 'tablet'])).toBe(`Connected devices (--device <serial>):
    emulator-5554  pixel
    R58M           unauthorized
Emulators (--avd <name>):
    pixel   running as emulator-5554
    tablet`)
  expect(formatAndroidTargets([], [])).toBe('Connected devices (--device <serial>):\n    none\nEmulators (--avd <name>):\n    none')
})

it('reads the URL baked into generated shells', async () => {
  await cli(['init', '--skip-install', '--url', 'http://localhost:4567/app'])
  expect(bakedUrl(tmp, 'ios')).toBe('http://localhost:4567/app')
  expect(bakedUrl(tmp, 'android')).toBe('http://localhost:4567/app')
})

describe('reversePorts', () => {
  it('forwards a local app URL port, defaulting to 80/443', () => {
    expect(reversePorts(tmp, 'http://localhost:3000')).toEqual({ ports: [3000], warning: undefined })
    expect(reversePorts(tmp, 'http://127.0.0.1')).toEqual({ ports: [80], warning: undefined })
    expect(reversePorts(tmp, 'https://localhost/app')).toEqual({ ports: [443], warning: undefined })
  })

  it('leaves remote and 10.0.2.2 URLs alone', () => {
    expect(reversePorts(tmp, 'https://acme.dev').ports).toEqual([])
    expect(reversePorts(tmp, 'http://10.0.2.2:8000').ports).toEqual([])
    expect(reversePorts(tmp, undefined).ports).toEqual([])
  })

  it("adds Laravel's Vite port: from public/hot, else Vite's default with a vite.config", () => {
    expect(reversePorts(tmp, 'http://localhost:8000').ports).toEqual([8000])
    file('vite.config.ts')
    expect(reversePorts(tmp, 'http://localhost:8000').ports).toEqual([8000, 5173])
    file('public/hot', 'http://127.0.0.1:5174')
    expect(reversePorts(tmp, 'http://localhost:8000').ports).toEqual([8000, 5174])
    file('public/hot', 'http://localhost:5175\n')
    expect(reversePorts(tmp, 'http://localhost:8000').ports).toEqual([8000, 5175])
  })

  it("adds rails-vite-plugin's port from tmp/rails-vite.json", () => {
    file('tmp/rails-vite.json', JSON.stringify({ url: 'http://127.0.0.1:5180', sourceDir: 'app/javascript' }))
    expect(reversePorts(tmp, 'http://localhost:3000').ports).toEqual([3000, 5180])
  })

  it.each([
    ['public/hot', 'http://[::1]:5173'],
    ['tmp/rails-vite.json', JSON.stringify({ url: 'http://[::1]:5173' })],
  ])('explains the fix when Vite puts [::1] URLs in the page (%s)', (path, content) => {
    file('vite.config.ts')
    file(path, content)
    const { ports, warning } = reversePorts(tmp, 'http://localhost:8000')
    expect(ports).toEqual([8000])
    expect(warning).toContain('Vite puts [::1]:5173 script URLs in the page')
    expect(warning).toContain("server: { hmr: { host: 'localhost' } }")
  })

  it("adds vite_ruby's dev server port (HMR)", () => {
    file('config/vite.json', JSON.stringify({ all: { port: 3036 }, development: { port: 3037 } }))
    expect(reversePorts(tmp, 'http://localhost:3000').ports).toEqual([3000, 3037])
    file('config/vite.json', JSON.stringify({ all: {} }))
    expect(reversePorts(tmp, 'http://localhost:3000').ports).toEqual([3000, 3036])
    file('config/vite.json', '{ nope')
    expect(reversePorts(tmp, 'http://localhost:3000').ports).toEqual([3000])
    file('vite.config.mts')
    expect(reversePorts(tmp, 'http://localhost:3000').ports).toEqual([3000, 5173])
  })
})

describe('findAndroidSdk', () => {
  const dir = (...path) => {
    const full = join(tmp, ...path)
    mkdirSync(full, { recursive: true })
    return full
  }

  it('prefers ANDROID_HOME, then ANDROID_SDK_ROOT, then local.properties, then the default location', () => {
    const home = dir('home')
    const fallback = dir('home', 'Library', 'Android', 'sdk')
    const fromProperties = dir('props sdk')
    dir('android')
    writeFileSync(join(tmp, 'android', 'local.properties'), `sdk.dir=${fromProperties.replaceAll(':', '\\:')}\n`)
    const a = dir('a')
    const b = dir('b')
    expect(findAndroidSdk({ ANDROID_HOME: a, ANDROID_SDK_ROOT: b }, tmp, home, 'darwin')).toBe(a)
    expect(findAndroidSdk({ ANDROID_HOME: join(tmp, 'missing'), ANDROID_SDK_ROOT: b }, tmp, home, 'darwin')).toBe(b)
    expect(findAndroidSdk({}, tmp, home, 'darwin')).toBe(fromProperties)
    rmSync(join(tmp, 'android'), { recursive: true })
    expect(findAndroidSdk({}, tmp, home, 'darwin')).toBe(fallback)
    expect(findAndroidSdk({}, tmp, home, 'linux')).toBeUndefined()
  })
})

it('uses JAVA_HOME when it has bin/java', () => {
  mkdirSync(join(tmp, 'jdk', 'bin'), { recursive: true })
  writeFileSync(join(tmp, 'jdk', 'bin', 'java'), '')
  expect(findJdk({ JAVA_HOME: join(tmp, 'jdk') }, { os: 'linux' })).toEqual({ home: join(tmp, 'jdk') })
})

describe('run errors', () => {
  it('needs a platform', async () => {
    const { code, stderr } = await cli(['run'])
    expect(code).toBe(1)
    expect(stderr).toContain('Usage: npx inertia-native run <ios|android>')
  })

  it('rejects unknown platforms', async () => {
    const { code, stderr } = await cli(['run', 'web'])
    expect(code).toBe(1)
    expect(stderr).toContain('Unknown platform "web": use ios or android.')
  })

  it.each(['ios', 'android'])('says how to create a missing %s shell', async (platform) => {
    const { code, stderr } = await cli(['run', platform])
    expect(code).toBe(1)
    expect(stderr).toContain(`✗ No ${platform}/ shell in ${tmp}. Create it with: npx inertia-native init ${platform}`)
  })

  it('prints help', async () => {
    const { code, stdout } = await cli(['run', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('--avd <name>')
    expect(stdout).toContain('--list')
  })
})

describe('run', () => {
  // A dev server, so that run doesn't warn that nothing answers.
  let server
  let url
  let port
  beforeAll(async () => {
    server = createServer((req, res) => res.end()).listen(0)
    await once(server, 'listening')
    port = server.address().port
    url = `http://localhost:${port}`
  })
  afterAll(() => {
    server.closeAllConnections()
    server.close()
  })

  describe('ios', () => {
    const app = () => join(tmp, 'ios', 'build', 'Build', 'Products', 'Debug-iphonesimulator', 'App.app')
    const simulatorApp = () => join(tmp, 'Xcode.app', 'Contents', 'Developer', 'Applications', 'Simulator.app')
    const openSimulator = () => `open ${simulatorApp()} --args -CurrentDeviceUDID udid-17`
    const xcodebuild = 'xcodebuild -project ios/App.xcodeproj -scheme App -configuration Debug -destination id=udid-17 -derivedDataPath ios/build -quiet build'
    const captures = (state, overrides = {}) => ({
      'xcode-select -p': { stdout: `${join(tmp, 'Xcode.app', 'Contents', 'Developer')}\n` },
      'xcrun simctl list devices available --json': {
        stdout: JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [sim('iPad Pro', 'ipad'), sim('iPhone 17', 'udid-17', state)] } }),
      },
      'xcrun simctl boot udid-17': {},
      [openSimulator()]: {},
      [`plutil -extract CFBundleIdentifier raw -o - ${app()}/Info.plist`]: { stdout: 'com.acme.shop\n' },
      'xcrun simctl bootstatus udid-17 -b': {},
      [`xcrun simctl install udid-17 ${app()}`]: {},
      'xcrun simctl launch --terminate-running-process udid-17 com.acme.shop': { stdout: 'com.acme.shop: 4242\n' },
      ...overrides,
    })
    const runIos = (state, { captures: overrides, status = 0 } = {}) =>
      cli(['run', 'ios'], { captures: captures(state, overrides), spawns: { [xcodebuild]: status } })
    beforeEach(async () => {
      mkdirSync(simulatorApp(), { recursive: true })
      await cli(['init', 'ios', '--skip-install', '--url', url, '--bundle-id', 'com.acme.shop'])
    })

    it('builds, installs and launches on the booted simulator', async () => {
      const { code, stdout, stderr, calls } = await runIos('Booted')
      expect(stderr).toBe('')
      expect(code).toBe(0)
      expect(calls).toEqual([
        'xcode-select -p',
        'xcrun simctl list devices available --json',
        openSimulator(),
        `$ ${xcodebuild}`,
        `plutil -extract CFBundleIdentifier raw -o - ${app()}/Info.plist`,
        'xcrun simctl bootstatus udid-17 -b',
        `xcrun simctl install udid-17 ${app()}`,
        'xcrun simctl launch --terminate-running-process udid-17 com.acme.shop',
      ])
      expect(stdout).toBe(
        '✓ Simulator: iPhone 17 (iOS 26.5)\n' +
          '› xcodebuild (the first build downloads Swift packages and takes a few minutes)\n' +
          '✓ Launched com.acme.shop on iPhone 17\n',
      )
    })

    it('boots the simulator first when none is booted', async () => {
      const { code, calls } = await runIos('Shutdown')
      expect(code).toBe(0)
      expect(calls.slice(1, 4)).toEqual(['xcrun simctl list devices available --json', 'xcrun simctl boot udid-17', openSimulator()])
    })

    it("stops when the simulator doesn't boot", async () => {
      const { code, stderr } = await runIos('Shutdown', { captures: { 'xcrun simctl boot udid-17': { ok: false, stderr: 'Unable to boot device\n' } } })
      expect(code).toBe(1)
      expect(stderr).toBe("✗ Couldn't boot iPhone 17: Unable to boot device\n")
    })

    it("opens the simulator in Xcode 27's Device Hub", async () => {
      rmSync(simulatorApp(), { recursive: true })
      mkdirSync(join(tmp, 'Xcode.app', 'Contents', 'Applications', 'DeviceHub.app'), { recursive: true })
      const { code, stderr, calls } = await runIos('Booted', { captures: { 'open devices://device/open?id=udid-17': {} } })
      expect(stderr).toBe('')
      expect(code).toBe(0)
      expect(calls[2]).toBe('open devices://device/open?id=udid-17')
    })

    it('asks Launch Services for either app elsewhere, and warns when neither opens', async () => {
      rmSync(simulatorApp(), { recursive: true })
      const { code, stdout, stderr, calls } = await runIos('Booted', {
        captures: {
          'open -a Simulator --args -CurrentDeviceUDID udid-17': { ok: false, stderr: 'Unable to find application named Simulator\n' },
          'open devices://device/open?id=udid-17': { ok: false },
        },
      })
      expect(code).toBe(0)
      expect(calls.slice(2, 4)).toEqual(['open -a Simulator --args -CurrentDeviceUDID udid-17', 'open devices://device/open?id=udid-17'])
      expect(stderr).toBe("! Couldn't open Simulator, so iPhone 17 has no window. Open Simulator (Device Hub from Xcode 27) to see the app.\n")
      expect(stdout).toContain('✓ Launched com.acme.shop on iPhone 17')
    })

    it('stops when xcodebuild fails', async () => {
      const { code, stderr, calls } = await runIos('Booted', { status: 65 })
      expect(code).toBe(1)
      expect(stderr).toBe('✗ xcodebuild failed; see the errors above.\n')
      expect(calls.at(-1)).toBe(`$ ${xcodebuild}`)
    })

    it('reports install and launch failures', async () => {
      const install = `xcrun simctl install udid-17 ${app()}`
      const notInstalled = await runIos('Booted', { captures: { [install]: { ok: false, stderr: 'No space left\n' } } })
      expect(notInstalled.code).toBe(1)
      expect(notInstalled.stderr).toBe("✗ Couldn't install on iPhone 17: No space left\n")
      expect(notInstalled.calls.at(-1)).toBe(install)

      const launch = 'xcrun simctl launch --terminate-running-process udid-17 com.acme.shop'
      const notLaunched = await runIos('Booted', { captures: { [launch]: { ok: false, stderr: 'FBSOpenApplicationError\n' } } })
      expect(notLaunched.code).toBe(1)
      expect(notLaunched.stderr).toBe("✗ Couldn't launch com.acme.shop: FBSOpenApplicationError\n")
    })
  })

  describe('android', () => {
    const am = 'adb -s emulator-5554 shell monkey -p com.acme.shop -c android.intent.category.LAUNCHER 1'
    const connected = 'List of devices attached\nemulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 transport_id:1\n'
    let env
    beforeEach(async () => {
      file('sdk/platform-tools/adb')
      file('jdk/bin/java')
      env = { ANDROID_HOME: join(tmp, 'sdk'), JAVA_HOME: join(tmp, 'jdk') }
      await cli(['init', 'android', '--skip-install', '--url', url, '--bundle-id', 'com.acme.shop'])
    })
    const captures = (overrides = {}) => ({
      'adb -s emulator-5554 emu avd name': { stdout: 'pixel\r\nOK\r\n' },
      [`adb -s emulator-5554 reverse tcp:${port} tcp:${port}`]: {},
      'adb -s emulator-5554 reverse tcp:5173 tcp:5173': {},
      [am]: { stdout: 'Events injected: 1\n' },
      ...overrides,
    })

    it('installs and launches on the connected device, forwarding the dev server port', async () => {
      const gradle = []
      const { code, stdout, stderr, calls } = await cli(['run', 'android'], {
        os: 'linux',
        env,
        captures: captures({ 'adb devices -l': { stdout: connected } }),
        spawns: { './gradlew installDebug': (options) => (gradle.push(options), 0) },
      })
      expect(stderr).toBe('')
      expect(code).toBe(0)
      expect(calls).toEqual([
        'adb devices -l',
        'adb -s emulator-5554 emu avd name',
        '$ ./gradlew installDebug',
        `adb -s emulator-5554 reverse tcp:${port} tcp:${port}`,
        am,
      ])
      expect(gradle).toEqual([
        { cwd: join(tmp, 'android'), env: { ...env, ANDROID_SERIAL: 'emulator-5554' } },
      ])
      expect(stdout).toBe(
        `✓ Android SDK: ${join(tmp, 'sdk')}\n` +
          `✓ JDK: ${join(tmp, 'jdk')}\n` +
          '› ./gradlew installDebug (emulator-5554)\n' +
          `✓ adb reverse tcp:${port} (localhost on emulator-5554 reaches this machine)\n` +
          '✓ Launched com.acme.shop on emulator-5554\n',
      )
    })

    it("warns about the ports adb can't forward and launches anyway", async () => {
      file('vite.config.ts')
      const { code, stdout, stderr } = await cli(['run', 'android'], {
        os: 'linux',
        env,
        captures: captures({ 'adb devices -l': { stdout: connected }, 'adb -s emulator-5554 reverse tcp:5173 tcp:5173': { ok: false } }),
        spawns: { './gradlew installDebug': 0 },
      })
      expect(code).toBe(0)
      expect(stdout).toContain(`✓ adb reverse tcp:${port} (localhost on emulator-5554 reaches this machine)\n`)
      expect(stderr).toBe("! Couldn't run adb reverse tcp:5173 tcp:5173\n")
      expect(stdout).toContain('✓ Launched com.acme.shop on emulator-5554')
    })

    it('fails when the app has no launcher activity', async () => {
      const { code, stderr } = await cli(['run', 'android'], {
        os: 'linux',
        env,
        captures: captures({
          'adb devices -l': { stdout: connected },
          [am]: { stdout: '** No activities found to run, monkey aborted.\n' },
        }),
        spawns: { './gradlew installDebug': 0 },
      })
      expect(code).toBe(1)
      expect(stderr).toBe("✗ Couldn't launch com.acme.shop: ** No activities found to run, monkey aborted.\n")
    })

    const booting = (overrides) =>
      captures({
        'adb devices -l': { stdout: 'List of devices attached\n' },
        'emulator -list-avds': { stdout: 'pixel\n' },
        'adb devices': { stdout: 'List of devices attached\nemulator-5554\tdevice\n' },
        ...overrides,
      })

    it('builds while the emulator boots', async () => {
      let built
      const { code, stdout, stderr, calls } = await cli(['run', 'android'], {
        os: 'linux',
        env,
        captures: booting({
          // Answers only once the build has started, and lets it finish.
          'adb -s emulator-5554 shell getprop sys.boot_completed': () => (built(0), { stdout: '1\n' }),
        }),
        spawns: {
          'emulator -avd pixel': (options) => (expect(options).toEqual({ background: true }), new Promise(() => {})),
          './gradlew assembleDebug': () => new Promise((resolve) => (built = resolve)),
          './gradlew installDebug': 0,
        },
      })
      expect(stderr).toBe('')
      expect(code).toBe(0)
      expect(calls.slice(0, 8)).toEqual([
        'adb devices -l',
        'emulator -list-avds',
        '$ emulator -avd pixel',
        '$ ./gradlew assembleDebug',
        'adb devices',
        'adb -s emulator-5554 emu avd name',
        'adb -s emulator-5554 shell getprop sys.boot_completed',
        '$ ./gradlew installDebug',
      ])
      expect(stdout).toContain('› Starting emulator pixel\n› ./gradlew assembleDebug')
      expect(stdout).toContain('✓ Emulator pixel booted (emulator-5554)\n› ./gradlew installDebug (emulator-5554)\n')
    })

    it('stops when the build fails while the emulator boots', async () => {
      const { code, stderr, calls } = await cli(['run', 'android'], {
        os: 'linux',
        env,
        captures: booting({ 'adb -s emulator-5554 shell getprop sys.boot_completed': { stdout: '\n' } }),
        spawns: { 'emulator -avd pixel': () => new Promise(() => {}), './gradlew assembleDebug': 1 },
      })
      expect(code).toBe(1)
      expect(stderr).toBe('✗ Gradle build failed; see the errors above.\n')
      // Stops waiting for the emulator, which would keep the CLI running.
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(calls).toEqual(['adb devices -l', 'emulator -list-avds', '$ emulator -avd pixel', '$ ./gradlew assembleDebug'])
    })

    it('fails when the emulator exits', async () => {
      const { code, stderr } = await cli(['run', 'android'], {
        os: 'linux',
        env,
        captures: booting(),
        spawns: { 'emulator -avd pixel': 1, './gradlew assembleDebug': 0 },
      })
      expect(code).toBe(1)
      expect(stderr).toBe("✗ Couldn't start pixel: the emulator exited (code 1). Try starting it from Android Studio's Device Manager.\n")
    })
  })
})
