import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { main } from '../bin/cli.mjs'
import { bakedUrl, findAndroidSdk, findJdk, parseAdbDevices, pickSimulator, reversePorts } from '../bin/run.mjs'

let tmp
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'inertia-native-run-'))
  writeFileSync(join(tmp, 'package.json'), '{}')
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

async function cli(args, cwd = tmp) {
  let stdout = ''
  let stderr = ''
  const code = await main(args, {
    cwd,
    env: {},
    stdin: /** @type {any} */ ({ isTTY: false }),
    stdout: { write: (s) => (stdout += s) },
    stderr: { write: (s) => (stderr += s) },
    exec: () => 0,
  })
  return { code, stdout, stderr }
}

const sim = (name, udid, state = 'Shutdown') => ({ name, udid, state, isAvailable: true })

describe('pickSimulator', () => {
  const list = {
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-18-2': [sim('iPhone 16', 'old-16'), sim('iPad Air', 'old-ipad')],
      'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [sim('iPad Pro', 'new-ipad'), sim('iPhone 17 Pro', 'new-17p'), sim('iPhone 17', 'new-17')],
      'com.apple.CoreSimulator.SimRuntime.iOS-26-10': [],
      'com.apple.CoreSimulator.SimRuntime.watchOS-26-0': [sim('Apple Watch', 'watch')],
    },
  }

  it('picks the first iPhone of the newest iOS runtime', () => {
    expect(pickSimulator(list)).toMatchObject({ udid: 'new-17p', runtime: '26.5' })
  })

  it('prefers a booted iPhone, then any booted simulator', () => {
    const booted = structuredClone(list)
    booted.devices['com.apple.CoreSimulator.SimRuntime.iOS-18-2'][0].state = 'Booted'
    expect(pickSimulator(booted)?.udid).toBe('old-16')
    const ipad = structuredClone(list)
    ipad.devices['com.apple.CoreSimulator.SimRuntime.iOS-18-2'][1].state = 'Booted'
    expect(pickSimulator(ipad)?.udid).toBe('old-ipad')
  })

  it('takes --device by UDID or by name (newest runtime first, booted preferred)', () => {
    expect(pickSimulator(list, 'old-16')?.udid).toBe('old-16')
    expect(pickSimulator(list, 'iPhone 16')?.udid).toBe('old-16')
    expect(pickSimulator(list, 'iPad Air')?.udid).toBe('old-ipad')
    expect(pickSimulator(list, 'iPhone 99')).toBeUndefined()
  })

  it('skips unavailable simulators and returns nothing without an iPhone', () => {
    const none = { devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [{ ...sim('iPhone 17', 'x'), isAvailable: false }, sim('iPad', 'y')] } }
    expect(pickSimulator(none)).toBeUndefined()
  })
})

it('parses adb devices', () => {
  const text = 'List of devices attached\nemulator-5554\tdevice\nR58M\tunauthorized\nemulator-5556\toffline\n\n'
  expect(parseAdbDevices(text)).toEqual([
    { serial: 'emulator-5554', state: 'device' },
    { serial: 'R58M', state: 'unauthorized' },
    { serial: 'emulator-5556', state: 'offline' },
  ])
})

it('reads the URL baked into generated shells', async () => {
  await cli(['init', '--skip-install', '--url', 'http://localhost:4567/app'])
  expect(bakedUrl(tmp, 'ios')).toBe('http://localhost:4567/app')
  expect(bakedUrl(tmp, 'android')).toBe('http://localhost:4567/app')
})

describe('reversePorts', () => {
  const file = (path, content = '') => {
    mkdirSync(join(tmp, path, '..'), { recursive: true })
    writeFileSync(join(tmp, path), content)
  }

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

  it("adds Laravel's Vite port: from public/hot, else 5173", () => {
    file('artisan')
    expect(reversePorts(tmp, 'http://localhost:8000').ports).toEqual([8000, 5173])
    file('public/hot', 'http://127.0.0.1:5174')
    expect(reversePorts(tmp, 'http://localhost:8000').ports).toEqual([8000, 5174])
    file('public/hot', 'http://localhost:5175\n')
    expect(reversePorts(tmp, 'http://localhost:8000').ports).toEqual([8000, 5175])
  })

  it('explains the fix when Vite listens on [::1] only', () => {
    file('artisan')
    file('public/hot', 'http://[::1]:5173')
    const { ports, warning } = reversePorts(tmp, 'http://localhost:8000')
    expect(ports).toEqual([8000])
    expect(warning).toContain("Vite listens on [::1]:5173 (IPv6) only")
    expect(warning).toContain("server: { host: '127.0.0.1' }")
  })

  it("adds vite_ruby's dev server port (HMR)", () => {
    file('config/vite.json', JSON.stringify({ all: { port: 3036 }, development: { port: 3037 } }))
    expect(reversePorts(tmp, 'http://localhost:3000').ports).toEqual([3000, 3037])
    file('config/vite.json', JSON.stringify({ all: {} }))
    expect(reversePorts(tmp, 'http://localhost:3000').ports).toEqual([3000, 3036])
    file('config/vite.json', '{ nope')
    expect(reversePorts(tmp, 'http://localhost:3000').ports).toEqual([3000])
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
  writeFileSync(join(tmp, 'jdk', 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), '')
  expect(findJdk({ JAVA_HOME: join(tmp, 'jdk') })).toEqual({ home: join(tmp, 'jdk') })
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
  })
})
