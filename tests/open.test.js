import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { main } from '../bin/cli.mjs'
import { ideCommand } from '../bin/open.mjs'

let tmp
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'inertia-native-open-'))
  writeFileSync(join(tmp, 'package.json'), '{}')
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

/** Runs the CLI with `exec` recorded and answering `status`. */
async function cli(args, { os = 'darwin', status = 0, env = {} } = {}) {
  let stdout = ''
  let stderr = ''
  const calls = []
  const code = await main(args, {
    cwd: tmp,
    env,
    os,
    stdin: /** @type {any} */ ({ isTTY: false }),
    stdout: { write: (s) => (stdout += s) },
    stderr: { write: (s) => (stderr += s) },
    exec: (cmd, args, options) => {
      calls.push([cmd, args, options.detached ?? false])
      return status
    },
  })
  return { code, stdout, stderr, calls }
}

/** An executable file in tmp. */
function executable(...path) {
  const file = join(tmp, ...path)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, '#!/bin/sh\n')
  chmodSync(file, 0o755)
  return file
}

describe('ideCommand', () => {
  it("uses Android Studio's studio or studio.sh launcher on Linux", () => {
    const studioSh = executable('opt', 'bin', 'studio.sh')
    const env = { PATH: [join(tmp, 'empty'), join(tmp, 'opt', 'bin')].join(delimiter) }
    expect(ideCommand('android', '/app/android', env, 'linux')).toEqual([studioSh, ['/app/android']])
    const studio = executable('toolbox', 'studio')
    expect(ideCommand('android', '/app/android', { PATH: `${env.PATH}${delimiter}${join(tmp, 'toolbox')}` }, 'linux')).toEqual([studio, ['/app/android']])
  })

  it('has nothing to run elsewhere', () => {
    writeFileSync(join(tmp, 'studio'), '') // not executable
    expect(ideCommand('android', '/app/android', { PATH: tmp }, 'linux')).toBeUndefined()
    expect(ideCommand('android', '/app/android', {}, 'linux')).toBeUndefined()
    expect(ideCommand('android', 'C:\\app\\android', { PATH: tmp }, 'win32')).toBeUndefined()
    expect(ideCommand('ios', '/app/ios/App.xcodeproj', { PATH: tmp }, 'linux')).toBeUndefined()
  })
})

describe('open', () => {
  const init = (platform, ...flags) => cli(['init', platform, '--skip-install', ...flags])

  it('opens the Xcode project', async () => {
    await init('ios')
    const { code, stdout, stderr, calls } = await cli(['open', 'ios'])
    expect(code).toBe(0)
    expect(calls).toEqual([['open', [join(tmp, 'ios', 'App.xcodeproj')], false]])
    expect(stdout).toBe('✓ Opened ios/App.xcodeproj in Xcode\n')
    expect(stderr).toBe('')
  })

  it("opens android/ in Android Studio with the adb reverse reminder for the app's ports", async () => {
    writeFileSync(join(tmp, 'vite.config.ts'), '')
    await init('android', '--url', 'http://localhost:8000')
    const { code, stdout, stderr, calls } = await cli(['open', 'android'])
    expect(code).toBe(0)
    expect(calls).toEqual([['open', ['-a', 'Android Studio', join(tmp, 'android')], false]])
    expect(stdout).toBe('✓ Opened android/ in Android Studio\n')
    expect(stderr).toBe(
      "! Android Studio doesn't forward ports. Once per emulator boot, run: adb reverse tcp:8000 tcp:8000 && adb reverse tcp:5173 tcp:5173 (or npm run android once)\n",
    )
  })

  it('skips the reminder for a remote URL', async () => {
    await init('android', '--url', 'https://acme.dev')
    const { stderr } = await cli(['open', 'android'])
    expect(stderr).toBe('')
  })

  it('starts studio.sh in the background on Linux', async () => {
    const studio = executable('bin', 'studio.sh')
    await init('android')
    const { code, calls } = await cli(['open', 'android'], { os: 'linux', env: { PATH: join(tmp, 'bin') } })
    expect(code).toBe(0)
    expect(calls).toEqual([[studio, [join(tmp, 'android')], true]])
  })

  it('prints the path when it has no way to start Android Studio', async () => {
    await init('android')
    const { code, stdout, stderr, calls } = await cli(['open', 'android'], { os: 'win32' })
    expect(code).toBe(0)
    expect(calls).toEqual([])
    expect(stdout).toBe(`Open ${join(tmp, 'android')} in Android Studio.\n`)
    expect(stderr).toContain('adb reverse tcp:3000 tcp:3000')
  })

  it('fails when the IDE does not start', async () => {
    await init('android')
    const { code, stderr } = await cli(['open', 'android'], { status: 1 })
    expect(code).toBe(1)
    expect(stderr).toBe(
      `✗ Couldn't start Android Studio. Open ${join(tmp, 'android')} in it yourself.\n` +
        "! Android Studio doesn't forward ports. Once per emulator boot, run: adb reverse tcp:3000 tcp:3000 (or npm run android once)\n",
    )
  })

  it('needs macOS for Xcode', async () => {
    await init('ios')
    const { code, stderr, calls } = await cli(['open', 'ios'], { os: 'linux' })
    expect(code).toBe(1)
    expect(calls).toEqual([])
    expect(stderr).toBe('✗ Xcode runs on macOS only.\n')
  })

  it.each(['ios', 'android'])('says how to create a missing %s shell', async (platform) => {
    const { code, stderr, calls } = await cli(['open', platform])
    expect(code).toBe(1)
    expect(calls).toEqual([])
    expect(stderr).toBe(`✗ No ${platform}/ shell in ${tmp}. Create it with: npx inertia-native init ${platform}\n`)
  })

  it('checks its arguments and prints help', async () => {
    expect((await cli(['open'])).stderr).toContain('Usage: npx inertia-native open <ios|android>')
    expect((await cli(['open', 'web'])).stderr).toBe('Unknown platform "web": use ios or android.\n')
    expect((await cli(['open', '--nope'])).code).toBe(1)
    const help = await cli(['open', '--help'])
    expect(help.code).toBe(0)
    expect(help.stdout).toContain('Usage: npx inertia-native open <ios|android>')
    expect((await cli(['--help'])).stdout).toContain('open <ios|android>        Open the native project in Xcode or Android Studio')
  })
})
