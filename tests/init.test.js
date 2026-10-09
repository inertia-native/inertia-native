import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { main } from '../bin/cli.mjs'
import { installSpec } from '../bin/init.mjs'
import { createPrompter } from '../bin/prompt.mjs'
import { bundleIdFromName, nameFromDirectory } from '../bin/shell.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const BIN = join(ROOT, 'bin', 'inertia-native.mjs')
const NAME_RULE = /^[A-Za-z0-9][A-Za-z0-9 .-]{0,29}$/
const BUNDLE_RULE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/
const ENTRY = `import { createInertiaApp } from '@inertiajs/react';

void createInertiaApp({});
`

let tmp
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'inertia-native-init-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

/** A project dir inside tmp with package.json and the given files (path => content). */
function project(dirName = 'acme-shop', files = {}) {
  const dir = join(tmp, dirName)
  mkdirSync(dir, { recursive: true })
  for (const [path, content] of Object.entries({ 'package.json': '{\n  "name": "x"\n}\n', ...files })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

/** Stands in for `npm install <spec>`: records the call and adds the dependency. */
function fakeInstaller(status = 0) {
  const calls = []
  const exec = (cmd, args, { cwd, env }) => {
    calls.push({ cmd, args, cwd, env })
    if (status === 0) {
      const path = join(cwd, 'package.json')
      const pkg = JSON.parse(readFileSync(path, 'utf8'))
      pkg.dependencies = { ...pkg.dependencies, 'inertia-native': '^1.0.0' }
      writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`)
    }
    return status
  }
  return { calls, exec }
}

/** Scripted prompts: answers by label; unanswered questions take the default. */
function fakePrompter(answers = {}) {
  const asked = []
  return {
    asked,
    async text(label, fallback, check) {
      asked.push({ label, fallback })
      const value = answers[label] ?? fallback
      const error = check?.(value)
      if (error) throw new Error(error)
      return value
    },
    async select(label, choices, fallback) {
      asked.push({ label, choices, fallback })
      return answers[label] ?? fallback
    },
    async confirm(label, fallback = true) {
      asked.push({ label, confirm: true })
      return answers[label] ?? fallback
    },
    close() {},
  }
}

async function cli(args, cwd, { exec = fakeInstaller().exec, prompter, env = {} } = {}) {
  let stdout = ''
  let stderr = ''
  const code = await main(args, {
    cwd,
    env,
    stdin: /** @type {any} */ ({ isTTY: false }),
    stdout: { write: (s) => (stdout += s) },
    stderr: { write: (s) => (stderr += s) },
    exec,
    prompter,
  })
  return { code, stdout, stderr }
}

/** Relative path => [mode, sha256] for every file, dotfiles included. */
function snapshot(root) {
  const tree = {}
  for (const path of readdirSync(root, { recursive: true }).sort()) {
    const full = join(root, path)
    const stat = statSync(full)
    if (stat.isDirectory()) continue
    tree[path] = [(stat.mode & 0o777).toString(8), createHash('sha256').update(readFileSync(full)).digest('hex')]
  }
  return tree
}

const listing = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).sort() : [])
const read = (...path) => readFileSync(join(...path), 'utf8')
const pkgJson = (dir) => JSON.parse(read(dir, 'package.json'))

describe('init on a Laravel-like app', () => {
  const laravel = () =>
    project('acme-shop', { artisan: '', 'package-lock.json': '{}', 'resources/js/app.tsx': ENTRY, 'resources/js/ssr.tsx': ENTRY })

  it('installs, patches, creates both shells and adds scripts', async () => {
    const dir = laravel()
    const installer = fakeInstaller()
    const { code, stdout, stderr } = await cli(['init', '--yes'], dir, { exec: installer.exec })
    expect(stderr).toBe('')
    expect(code).toBe(0)
    expect(stdout).toBe(`✓ Found entrypoint resources/js/app.tsx
✓ App name: Acme Shop (--name to change)
✓ Bundle ID: com.example.acmeshop (--bundle-id to change)
✓ Dev server URL: http://localhost:8000 (found artisan; --url to change)
› npm install inertia-native
✓ Added inertia-native to package.json (npm)
✓ Patched resources/js/app.tsx
✓ Created ios/ and android/
✓ Added "ios" and "android" scripts to package.json

Next: start your dev server (composer run dev), then run: npm run ios (or npm run android)
`)
    expect(installer.calls.map((c) => [c.cmd, c.args, c.cwd])).toEqual([['npm', ['install', 'inertia-native'], dir]])
    expect(read(dir, 'resources/js/app.tsx')).toContain("import { initInertiaNative } from 'inertia-native';\n")
    expect(read(dir, 'resources/js/ssr.tsx')).toBe(ENTRY)
    expect(read(dir, 'ios/App/AppConfig.swift')).toContain('"http://localhost:8000"')
    expect(pkgJson(dir).scripts).toEqual({ ios: 'inertia-native run ios', android: 'inertia-native run android' })
  })

  it('changes nothing when re-run', async () => {
    const dir = laravel()
    await cli(['init', '--yes'], dir)
    const before = snapshot(dir)
    const installer = fakeInstaller()
    const { code, stdout, stderr } = await cli(['init', '--yes'], dir, { exec: installer.exec })
    expect(code).toBe(0)
    expect(snapshot(dir)).toEqual(before)
    expect(installer.calls).toEqual([])
    expect(stdout).toContain('✓ inertia-native is already in package.json')
    expect(stdout).toContain('✓ resources/js/app.tsx already calls initInertiaNative()')
    expect(stdout).toContain('✓ package.json already has the scripts')
    expect(stdout).not.toContain('App name')
    expect(stderr).toContain('! Skipped ios/: it already exists (--force replaces it)')
    expect(stderr).toContain('! Skipped android/: it already exists')
  })
})

describe('defaults', () => {
  it('uses port 3000 and bin/dev when bin/rails and bin/dev exist', async () => {
    const dir = project('acme-shop', { 'bin/rails': '', 'bin/dev': '' })
    const { stdout } = await cli(['init', 'ios', '--yes'], dir)
    expect(stdout).toContain('✓ Dev server URL: http://localhost:3000 (found bin/rails')
    expect(stdout).toContain('Next: start your dev server (bin/dev), then run: npm run ios\n')
    expect(read(dir, 'ios/App/AppConfig.swift')).toContain('"http://localhost:3000"')
  })

  it('uses port 3000 when neither artisan nor bin/rails exists', async () => {
    const dir = project()
    const { stdout } = await cli(['init', 'ios', '--yes'], dir)
    expect(stdout).toContain('✓ Dev server URL: http://localhost:3000 (default')
    expect(stdout).toContain('Next: start your dev server, then run: npm run ios\n')
  })

  it('derives the bundle ID from --name when given', async () => {
    const dir = project()
    const { stdout } = await cli(['init', 'ios', '--name', 'Shop 2'], dir)
    expect(stdout).toContain('✓ Bundle ID: com.example.shop2')
    expect(stdout).not.toContain('App name')
  })

  it('writes at the nearest directory with package.json', async () => {
    const dir = project('acme-shop', { artisan: '', 'resources/js/app.tsx': ENTRY })
    const nested = join(dir, 'resources', 'js')
    const { code, stdout } = await cli(['init', 'ios'], nested)
    expect(code).toBe(0)
    expect(existsSync(join(dir, 'ios', 'App.xcodeproj'))).toBe(true)
    expect(existsSync(join(nested, 'ios'))).toBe(false)
    expect(stdout).toContain('✓ Found entrypoint app.tsx')
    expect(stdout).toContain('✓ Created ../../ios/')
  })

  it('fails without a package.json', async () => {
    const { code, stderr } = await cli(['init'], tmp)
    expect(code).toBe(1)
    expect(stderr).toContain('No package.json')
    expect(listing(tmp)).toEqual([])
  })
})

describe('name derivation', () => {
  it.each([
    ['acme-shop', 'Acme Shop', 'com.example.acmeshop'],
    ['my_app', 'My App', 'com.example.myapp'],
    ['acme.shop  v2', 'Acme Shop V2', 'com.example.acmeshopv2'],
    ['inertiaRails', 'InertiaRails', 'com.example.inertiarails'],
    ['café-crème', 'Cafe Creme', 'com.example.cafecreme'],
    ['3d-printer', '3d Printer', 'com.example.app3dprinter'],
    ['2024', '2024', 'com.example.app2024'],
    ['-leading-dash-', 'Leading Dash', 'com.example.leadingdash'],
  ])('%s -> %s / %s', (dir, name, bundleId) => {
    expect(nameFromDirectory(dir)).toBe(name)
    expect(bundleIdFromName(name)).toBe(bundleId)
    expect(name).toMatch(NAME_RULE)
    expect(bundleId).toMatch(BUNDLE_RULE)
  })

  it('keeps whole words up to 30 characters', () => {
    const name = nameFromDirectory('the-quite-long-name-of-a-laravel-application')
    expect(name).toBe('The Quite Long Name Of A')
    expect(name).toMatch(NAME_RULE)
  })

  it('cuts a single long word at 30 characters', () => {
    const name = nameFromDirectory('supercalifragilisticexpialidocious')
    expect(name).toBe('Supercalifragilisticexpialidoc')
    expect(name).toMatch(NAME_RULE)
  })

  it('gives up when nothing usable is left', () => {
    expect(nameFromDirectory('アプリ')).toBe('')
    expect(nameFromDirectory('___')).toBe('')
  })

  it('asks for --name when the directory name gives nothing, changing nothing', async () => {
    const dir = project('アプリ')
    const { code, stderr } = await cli(['init', '--yes'], dir)
    expect(code).toBe(1)
    expect(stderr).toContain('Pass --name')
    expect(stderr).toContain('Nothing was changed.')
    expect(stderr).not.toContain('--bundle-id')
    expect(listing(dir)).toEqual(['package.json'])
  })

  it('accepts --name for such a directory', async () => {
    const dir = project('アプリ')
    const { code, stdout } = await cli(['init', 'ios', '--name', 'Apuri'], dir)
    expect(code).toBe(0)
    expect(stdout).toContain('com.example.apuri')
  })
})

describe('validation', () => {
  it.each([
    [['--name', ' Acme'], '--name'],
    [['--name', 'A'.repeat(31)], '--name'],
    [['--name', 'Acme "Shop"'], '--name'],
    [['--name='], '--name'],
    [['--bundle-id', 'com.acme-shop.app'], '--bundle-id'],
    [['--bundle-id', 'com.acme_shop'], '--bundle-id'],
    [['--bundle-id', 'Com.Acme'], '--bundle-id'],
    [['--bundle-id', 'acme'], '--bundle-id'],
    [['--bundle-id', 'com.1acme'], '--bundle-id'],
    [['--url', 'http://localhost:8000/'], '--url'],
    [['--url', 'localhost:8000'], '--url'],
    [['--url', 'http://localhost:8000/?a=1'], '--url'],
    [['--url', 'http://local"host'], '--url'],
    [['--url', 'http://$HOST'], '--url'],
    [['--entrypoint', 'resources/js/missing.tsx'], '--entrypoint'],
  ])('%j aborts naming %s and changes nothing', async (args, flag) => {
    const dir = project('acme-shop', { artisan: '', 'resources/js/app.tsx': ENTRY })
    const before = snapshot(dir)
    const installer = fakeInstaller()
    const prompter = fakePrompter()
    const { code, stdout, stderr } = await cli(['init', ...args], dir, { exec: installer.exec, prompter })
    expect(code).toBe(1)
    expect(stderr).toContain(`Invalid ${flag} `)
    expect(stderr).toContain('Nothing was changed.')
    expect(stdout).toBe('')
    expect(snapshot(dir)).toEqual(before)
    expect(installer.calls).toEqual([])
    expect(prompter.asked).toEqual([])
  })

  it('reports every invalid flag at once', async () => {
    const dir = project()
    const { stderr } = await cli(['init', '--name=-x', '--bundle-id', 'x', '--url', 'ftp://x'], dir)
    expect(stderr).toContain('Invalid --name')
    expect(stderr).toContain('Invalid --bundle-id')
    expect(stderr).toContain('Invalid --url')
  })

  it.each([[['init', 'web']], [['init', 'ios', 'android']], [['init', '--nmae', 'Acme']], [['init', '--name']], [['setup']], [[]]])(
    '%j fails and changes nothing',
    async (args) => {
      const dir = project()
      const before = snapshot(dir)
      const { code, stdout } = await cli(args, dir)
      expect(code).toBe(1)
      expect(stdout).toBe('')
      expect(snapshot(dir)).toEqual(before)
    },
  )

  it('prints help', async () => {
    for (const args of [['--help'], ['-h'], ['help'], ['init', '--help']]) {
      const { code, stdout } = await cli(args, tmp)
      expect(code).toBe(0)
      expect(stdout).toContain('Usage: npx inertia-native init [ios|android|both]')
    }
  })
})

describe('package', () => {
  it.each([
    ['pnpm-lock.yaml', 'pnpm', ['add', 'inertia-native']],
    ['yarn.lock', 'yarn', ['add', 'inertia-native']],
    ['bun.lock', 'bun', ['add', 'inertia-native']],
    ['bun.lockb', 'bun', ['add', 'inertia-native']],
    ['package-lock.json', 'npm', ['install', 'inertia-native']],
  ])('uses the package manager of %s', async (lockfile, cmd, args) => {
    const dir = project('acme-shop', { [lockfile]: '' })
    const installer = fakeInstaller()
    const { stdout } = await cli(['init', 'ios'], dir, { exec: installer.exec })
    expect(installer.calls.map((c) => [c.cmd, c.args])).toEqual([[cmd, args]])
    expect(stdout).toContain(`✓ Added inertia-native to package.json (${cmd})`)
    expect(stdout).toContain(`then run: ${cmd} run ios`)
  })

  it('falls back to the packageManager field, then npm', async () => {
    const dir = project('acme-shop', { 'package.json': '{ "packageManager": "pnpm@9.0.0" }' })
    const installer = fakeInstaller()
    await cli(['init', 'ios'], dir, { exec: installer.exec })
    expect(installer.calls[0].cmd).toBe('pnpm')
  })

  it('skips the install when the package is already a (dev) dependency', async () => {
    const dir = project('acme-shop', { 'package.json': '{ "devDependencies": { "inertia-native": "^1.0.0" } }' })
    const installer = fakeInstaller()
    const { stdout } = await cli(['init', 'ios'], dir, { exec: installer.exec })
    expect(installer.calls).toEqual([])
    expect(stdout).toContain('✓ inertia-native is already in package.json')
  })

  it('skips the install with --skip-install, saying how to add it', async () => {
    const dir = project('acme-shop', { 'yarn.lock': '' })
    const installer = fakeInstaller()
    const { code, stderr } = await cli(['init', 'ios', '--skip-install'], dir, { exec: installer.exec })
    expect(code).toBe(0)
    expect(installer.calls).toEqual([])
    expect(stderr).toContain('! Skipped adding inertia-native (--skip-install). Add it with: yarn add inertia-native')
  })

  it('carries on but exits 1 when the install fails', async () => {
    const dir = project('acme-shop', { 'resources/js/app.tsx': ENTRY })
    const { code, stdout, stderr } = await cli(['init', 'ios'], dir, { exec: fakeInstaller(1).exec })
    expect(code).toBe(1)
    expect(stderr).toContain("✗ Couldn't add inertia-native. Run this yourself: npm install inertia-native")
    expect(stdout).toContain('✓ Patched resources/js/app.tsx')
    expect(existsSync(join(dir, 'ios'))).toBe(true)
  })

  it('installs the tarball that `npx --package <tarball>` ran it from', async () => {
    const dir = project()
    const installer = fakeInstaller()
    const env = { npm_command: 'exec', npm_config_package: '../pkg/inertia-native-1.0.0.tgz', PATH: '/bin' }
    await cli(['init', 'ios'], dir, { exec: installer.exec, env })
    expect(installer.calls[0].args).toEqual(['install', resolve(tmp, 'pkg/inertia-native-1.0.0.tgz')])
    expect(installer.calls[0].env).toEqual({ npm_command: 'exec', PATH: '/bin' })
  })

  it.each([
    [{}, 'inertia-native'],
    [{ npm_command: 'exec', npm_config_package: '' }, 'inertia-native'],
    [{ npm_command: 'exec', npm_config_package: 'inertia-native@next' }, 'inertia-native@next'],
    [{ npm_command: 'exec', npm_config_package: 'inertia-native' }, 'inertia-native'],
    [{ npm_command: 'exec', npm_config_package: 'other-cli' }, 'inertia-native'],
    [{ npm_command: 'exec', npm_config_package: 'a.tgz\nb.tgz' }, 'inertia-native'],
    [{ npm_command: 'exec', npm_config_package: '/abs/inertia-native-1.0.0.tgz' }, '/abs/inertia-native-1.0.0.tgz'],
    [{ npm_command: 'exec', npm_config_package: 'https://x.dev/i.tgz' }, 'https://x.dev/i.tgz'],
    [{ npm_command: 'run-script', npm_config_package: '/abs/i.tgz' }, 'inertia-native'],
  ])('install spec for %j is %s', (env, spec) => {
    expect(installSpec(env, '/app')).toBe(spec)
  })
})

describe('entrypoint', () => {
  it('prints the two lines when no file calls createInertiaApp(, and carries on', async () => {
    const dir = project()
    const { code, stderr } = await cli(['init', 'ios'], dir)
    expect(code).toBe(0)
    expect(stderr).toContain('! Found no file calling createInertiaApp( under resources/js, app/frontend, app/javascript, src')
    expect(stderr).toContain("    import { initInertiaNative } from 'inertia-native'\n    initInertiaNative() // before createInertiaApp(...)\n")
    expect(existsSync(join(dir, 'ios'))).toBe(true)
  })

  it('prints the two lines and leaves the file alone when it cannot patch it', async () => {
    const source = "import { createInertiaApp } from '@inertiajs/react'\n\nboot(createInertiaApp({}))\n"
    const dir = project('acme-shop', { 'src/main.ts': source })
    const { code, stderr } = await cli(['init', 'ios'], dir)
    expect(code).toBe(0)
    expect(stderr).toContain("! Couldn't patch src/main.ts: createInertiaApp( does not start its own statement.")
    expect(stderr).toContain("import { initInertiaNative } from 'inertia-native'")
    expect(read(dir, 'src/main.ts')).toBe(source)
  })

  it('uses the first of several without a terminal, naming the others', async () => {
    const dir = project('acme-shop', { 'resources/js/app.tsx': ENTRY, 'resources/js/admin/app.tsx': ENTRY })
    const { stdout } = await cli(['init', 'ios'], dir)
    expect(stdout).toContain('✓ Found entrypoint resources/js/app.tsx (also: resources/js/admin/app.tsx; pick one with --entrypoint)')
    expect(read(dir, 'resources/js/app.tsx')).toContain('initInertiaNative')
    expect(read(dir, 'resources/js/admin/app.tsx')).toBe(ENTRY)
  })

  it('asks which of several to patch in a terminal', async () => {
    const dir = project('acme-shop', { 'resources/js/app.tsx': ENTRY, 'resources/js/admin/app.tsx': ENTRY })
    const prompter = fakePrompter({ 'Which file is your Inertia entrypoint?': 'resources/js/admin/app.tsx' })
    await cli(['init', 'ios'], dir, { prompter })
    expect(prompter.asked).toContainEqual({
      label: 'Which file is your Inertia entrypoint?',
      choices: ['resources/js/app.tsx', 'resources/js/admin/app.tsx'],
      fallback: 'resources/js/app.tsx',
    })
    expect(read(dir, 'resources/js/admin/app.tsx')).toContain('initInertiaNative')
    expect(read(dir, 'resources/js/app.tsx')).toBe(ENTRY)
  })

  it('patches --entrypoint instead of searching', async () => {
    const dir = project('acme-shop', { 'resources/js/app.tsx': ENTRY, 'client/boot.js': ENTRY })
    const { stdout } = await cli(['init', 'ios', '--entrypoint', 'client/boot.js'], dir)
    expect(stdout).not.toContain('Found entrypoint')
    expect(stdout).toContain('✓ Patched client/boot.js')
    expect(read(dir, 'resources/js/app.tsx')).toBe(ENTRY)
  })
})

describe('prompts', () => {
  it('asks for platforms and values in order, with defaults, and uses the answers', async () => {
    const dir = project('acme-shop', { artisan: '', 'resources/js/app.tsx': ENTRY })
    const prompter = fakePrompter({ Platforms: 'android', 'App name': 'Shop 9' })
    const { code, stdout } = await cli(['init'], dir, { prompter })
    expect(code).toBe(0)
    expect(prompter.asked).toEqual([
      { label: 'Platforms', choices: ['both', 'ios', 'android'], fallback: 'both' },
      { label: 'App name', fallback: 'Acme Shop' },
      { label: 'Bundle ID', fallback: 'com.example.shop9' },
      { label: 'Dev server URL', fallback: 'http://localhost:8000' },
    ])
    expect(existsSync(join(dir, 'ios'))).toBe(false)
    expect(read(dir, 'android/app/src/main/res/values/strings.xml')).toContain('Shop 9')
    expect(pkgJson(dir).scripts).toEqual({ android: 'inertia-native run android' })
    expect(stdout).toContain('then run: npm run android\n')
  })

  it('skips the prompt of every flag given', async () => {
    const dir = project()
    const prompter = fakePrompter()
    await cli(['init', 'ios', '--name', 'A', '--bundle-id', 'com.a.b', '--url', 'http://localhost:1234'], dir, { prompter })
    expect(prompter.asked).toEqual([])
  })

  it('asks nothing with --yes', async () => {
    const dir = project('acme-shop', { 'resources/js/app.tsx': ENTRY, 'resources/js/admin/app.tsx': ENTRY })
    const prompter = fakePrompter()
    const { code } = await cli(['init', '--yes'], dir, { prompter })
    expect(code).toBe(0)
    expect(prompter.asked).toEqual([])
  })

  it('asks no values when every shell exists', async () => {
    const dir = project('acme-shop', { 'ios/keep.txt': '', 'android/keep.txt': '' })
    const prompter = fakePrompter()
    await cli(['init'], dir, { prompter })
    expect(prompter.asked.map((q) => q.label)).toEqual(['Platforms'])
  })

  it('re-asks after an invalid answer (terminal prompter)', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    let shown = ''
    output.on('data', (chunk) => (shown += chunk))
    const prompter = createPrompter(input, output)
    const answer = prompter.text('Bundle ID', 'com.example.a', (v) => (BUNDLE_RULE.test(v) ? undefined : 'nope'))
    input.write('Com.Bad\n')
    await new Promise((r) => setTimeout(r, 10))
    input.write('com.good.app\n')
    expect(await answer).toBe('com.good.app')
    const picked = prompter.select('Platforms', ['both', 'ios', 'android'], 'both')
    input.write('\n')
    expect(await picked).toBe('both')
    const numbered = prompter.select('Entrypoint', ['a/x.ts', 'b/y.ts'], 'a/x.ts')
    input.write('2\n')
    expect(await numbered).toBe('b/y.ts')
    for (const [typed, expected] of [['\n', true], ['Y\n', true], ['no\n', false]]) {
      const confirmed = prompter.confirm('Change it?')
      input.write(typed)
      expect(await confirmed).toBe(expected)
    }
    const declined = prompter.confirm('Replace?', false)
    input.write('\n')
    expect(await declined).toBe(false)
    const retried = prompter.confirm('Really?')
    input.write('maybe\n')
    await new Promise((r) => setTimeout(r, 10))
    input.write('n\n')
    expect(await retried).toBe(false)
    prompter.close()
    expect(shown).toContain('? Bundle ID (com.example.a) › ')
    expect(shown).toContain('  nope\n')
    expect(shown).toContain('? Platforms [both/ios/android] (both) › ')
    expect(shown).toContain('  2) b/y.ts\n')
    expect(shown).toContain('? Change it? (Y/n) › ')
    expect(shown).toContain('? Replace? (y/N) › ')
    expect(shown).toContain('  Answer y or n\n')
  })

  it('numbers choices with spaces and asks nothing until a question comes', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    let shown = ''
    output.on('data', (chunk) => (shown += chunk))
    const prompter = createPrompter(input, output)
    prompter.close()
    expect(input.listenerCount('data')).toBe(0)
    const picked = prompter.select('Simulator', ['iPhone 17 (iOS 26.5)', 'iPhone 16 (iOS 18.2)'], 'iPhone 17 (iOS 26.5)')
    input.write('2\n')
    expect(await picked).toBe('iPhone 16 (iOS 18.2)')
    prompter.close()
    prompter.close()
    expect(shown).toContain('  1) iPhone 17 (iOS 26.5)\n  2) iPhone 16 (iOS 18.2)\n? Simulator [1-2] (iPhone 17 (iOS 26.5)) › ')
  })
})

describe('Vite host for Android', () => {
  const VITE = "import { defineConfig } from 'vite'\n\nexport default defineConfig({\n  plugins: [],\n})\n"
  const PATCHED = "import { defineConfig } from 'vite'\n\nexport default defineConfig({\n  server: { host: '127.0.0.1' },\n  plugins: [],\n})\n"
  const QUESTION = 'Set server.host to 127.0.0.1 in vite.config.ts, so Android can load scripts from Vite?'
  const app = (files = { 'vite.config.ts': VITE }) => project('acme-shop', { artisan: '', 'resources/js/app.tsx': ENTRY, ...files })

  it('changes the Vite config with --yes', async () => {
    const dir = app()
    const { code, stdout, stderr } = await cli(['init', '--yes'], dir)
    expect(code).toBe(0)
    expect(stderr).toBe('')
    expect(stdout).toContain('✓ Patched resources/js/app.tsx\n✓ Set server.host to 127.0.0.1 in vite.config.ts\n✓ Created ios/ and android/')
    expect(read(dir, 'vite.config.ts')).toBe(PATCHED)
  })

  it('asks in a terminal, after the other questions, and changes it on yes', async () => {
    const dir = app()
    const prompter = fakePrompter()
    await cli(['init'], dir, { prompter })
    expect(prompter.asked.map((q) => q.label)).toEqual(['Platforms', 'App name', 'Bundle ID', 'Dev server URL', QUESTION])
    expect(read(dir, 'vite.config.ts')).toBe(PATCHED)
  })

  it('leaves it alone on no, with the hint', async () => {
    const dir = app()
    const { stderr } = await cli(['init', 'android'], dir, { prompter: fakePrompter({ [QUESTION]: false }) })
    expect(read(dir, 'vite.config.ts')).toBe(VITE)
    expect(stderr).toBe(
      "! Android can't load scripts from Vite at [::1], its default address on macOS. For Android, set server.host to '127.0.0.1' in vite.config.ts.\n",
    )
  })

  it('prints the hint without a terminal, changing nothing', async () => {
    const dir = app()
    const { code, stderr } = await cli(['init'], dir)
    expect(code).toBe(0)
    expect(read(dir, 'vite.config.ts')).toBe(VITE)
    expect(stderr).toContain("For Android, set server.host to '127.0.0.1' in vite.config.ts (or re-run with --yes).\n")
  })

  it('does nothing for iOS only', async () => {
    const dir = app()
    const prompter = fakePrompter()
    const { stdout, stderr } = await cli(['init', 'ios'], dir, { prompter })
    expect(read(dir, 'vite.config.ts')).toBe(VITE)
    expect(prompter.asked.map((q) => q.label)).not.toContain(QUESTION)
    expect(stdout + stderr).not.toContain('Vite')
  })

  it('says so when already set, asking nothing', async () => {
    const dir = app({ 'vite.config.ts': PATCHED })
    const prompter = fakePrompter()
    const { stdout } = await cli(['init', 'android'], dir, { prompter })
    expect(prompter.asked.map((q) => q.label)).not.toContain(QUESTION)
    expect(stdout).toContain('✓ vite.config.ts already sets server.host\n')
    expect(read(dir, 'vite.config.ts')).toBe(PATCHED)
  })

  it('explains why when it cannot change the file', async () => {
    const source = "export default defineConfig({ server: { host: 'localhost' } })\n"
    const dir = app({ 'vite.config.js': source })
    const { code, stderr } = await cli(['init', 'android', '--yes'], dir)
    expect(code).toBe(0)
    expect(read(dir, 'vite.config.js')).toBe(source)
    expect(stderr).toContain(
      "! Couldn't change vite.config.js: it already sets server.host to 'localhost'. Android can't load scripts from Vite at [::1], " +
        "its default address on macOS; for Android, set server.host to '127.0.0.1' there by hand.",
    )
  })

  it("leaves vite_ruby apps alone: Rails proxies Vite, so Android needs no change", async () => {
    const json = '{\n  "development": {\n    "port": 3036\n  }\n}\n'
    const dir = app({ 'vite.config.ts': VITE, 'config/vite.json': json, 'bin/rails': '' })
    const prompter = fakePrompter()
    const { stdout, stderr } = await cli(['init', 'android'], dir, { prompter })
    expect(prompter.asked.map((q) => q.label)).not.toContain(QUESTION)
    expect(stdout + stderr).not.toContain('Vite')
    expect(read(dir, 'config/vite.json')).toBe(json)
    expect(read(dir, 'vite.config.ts')).toBe(VITE)
  })

  it('changes nothing when re-run', async () => {
    const dir = app()
    await cli(['init', '--yes'], dir)
    const before = snapshot(dir)
    const { stdout } = await cli(['init', '--yes'], dir)
    expect(snapshot(dir)).toEqual(before)
    expect(stdout).toContain('✓ vite.config.ts already sets server.host')
  })
})

describe('package.json scripts', () => {
  it('keeps an existing script with the same name, with a warning', async () => {
    const dir = project('acme-shop', { 'package.json': '{ "scripts": { "ios": "cap run ios" } }' })
    const { stdout, stderr } = await cli(['init'], dir)
    expect(pkgJson(dir).scripts).toEqual({ ios: 'cap run ios', android: 'inertia-native run android' })
    expect(stderr).toContain('! Kept your own "ios" script; use `npx inertia-native run ios` to run the app')
    expect(stdout).toContain('✓ Added "android" script to package.json')
  })

  it.each([
    ['4 spaces', '{\n    "name": "x",\n    "scripts": {\n        "dev": "vite"\n    }\n}\n'],
    ['tabs', '{\n\t"name": "x"\n}'],
    ['CRLF', '{\r\n  "name": "x"\r\n}\r\n'],
  ])('keeps the package.json style (%s)', async (_, text) => {
    const dir = project('acme-shop', { 'package.json': text })
    await cli(['init', 'ios', '--skip-install'], dir)
    const after = read(dir, 'package.json')
    const indent = text.match(/^([ \t]+)"/m)[1]
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    expect(after).toBe(JSON.stringify({ ...JSON.parse(text), scripts: { ...JSON.parse(text).scripts, ios: 'inertia-native run ios' } }, null, indent).replaceAll('\n', eol) + (text.endsWith('\n') ? eol : ''))
  })
})

describe('existing shells', () => {
  it('skips an existing platform with a warning and exit 0, writing the other', async () => {
    const dir = project('acme-shop', { 'ios/mine.txt': 'keep me' })
    const { code, stdout, stderr } = await cli(['init'], dir)
    expect(code).toBe(0)
    expect(stderr).toContain('! Skipped ios/: it already exists (--force replaces it)')
    expect(stdout).toContain('✓ Created android/\n')
    expect(listing(join(dir, 'ios'))).toEqual(['mine.txt'])
    expect(existsSync(join(dir, 'android', 'gradlew'))).toBe(true)
  })

  it('replaces existing platforms with --force', async () => {
    const dir = project()
    await cli(['init', 'ios', '--name', 'Old'], dir)
    writeFileSync(join(dir, 'ios', 'mine.txt'), 'stale')
    const { code, stdout } = await cli(['init', 'ios', '--force'], dir)
    expect(code).toBe(0)
    expect(stdout).toContain('✓ Created ios/ (replaced)')
    expect(existsSync(join(dir, 'ios', 'mine.txt'))).toBe(false)
    expect(read(dir, 'ios/App.xcodeproj/project.pbxproj')).toContain('Acme Shop')
  })

  it('asks before replacing in a terminal, defaulting to no', async () => {
    const dir = project('acme-shop', { 'ios/mine.txt': 'keep me', 'android/mine.txt': 'keep me' })
    const prompter = fakePrompter()
    const { code, stderr } = await cli(['init', '--force'], dir, { prompter })
    expect(code).toBe(0)
    expect(prompter.asked.map((q) => q.label)).toEqual(['Platforms', 'Replace ios/ and android/? Everything in them is deleted.'])
    expect(stderr).toContain('! Skipped ios/: it already exists\n')
    expect(listing(join(dir, 'ios'))).toEqual(['mine.txt'])
    expect(listing(join(dir, 'android'))).toEqual(['mine.txt'])
  })

  it('replaces on yes in a terminal, and without asking with --yes', async () => {
    const question = 'Replace ios/? Everything in it is deleted.'
    const dir = project('acme-shop', { 'ios/mine.txt': 'stale' })
    await cli(['init', 'ios', '--force'], dir, { prompter: fakePrompter({ [question]: true }) })
    expect(existsSync(join(dir, 'ios', 'mine.txt'))).toBe(false)
    writeFileSync(join(dir, 'ios', 'mine.txt'), 'stale')
    const prompter = fakePrompter()
    await cli(['init', 'ios', '--force', '--yes'], dir, { prompter })
    expect(prompter.asked).toEqual([])
    expect(existsSync(join(dir, 'ios', 'mine.txt'))).toBe(false)
  })
})

describe.each([
  ['ios', {
    'App/AppConfig.swift': ['URL(string: "http://localhost:8000")'],
    'App.xcodeproj/project.pbxproj': ['INFOPLIST_KEY_CFBundleDisplayName = "Acme 2.0"', 'PRODUCT_BUNDLE_IDENTIFIER = "com.acme.app"'],
  }],
  ['android', {
    'app/build.gradle.kts': ['applicationId = "com.acme.app"', '"BASE_URL", "\\"http://localhost:8000\\""'],
    'app/src/main/res/values/strings.xml': ['<string name="app_name">Acme 2.0</string>'],
  }],
])('%s output', (platform, filled) => {
  const values = ['--name', 'Acme 2.0', '--bundle-id', 'com.acme.app', '--url', 'http://localhost:8000']
  const template = join(ROOT, 'templates', platform)

  it('fills in the values', async () => {
    const dir = project()
    expect((await cli(['init', platform, ...values], dir)).code).toBe(0)
    for (const [file, lines] of Object.entries(filled)) {
      for (const line of lines) expect(read(dir, platform, file), file).toContain(line)
    }
  })

  it('copies every other file as is, modes included', async () => {
    const dir = project()
    await cli(['init', platform, ...values], dir)
    const { files } = JSON.parse(read(template, 'inertia-native-template.json'))
    const expected = {}
    for (const [path, entry] of Object.entries(snapshot(template))) {
      if (path === 'inertia-native-template.json' || files.includes(path)) continue
      expected[path.replace(/(^|\/)gitignore$/, '$1.gitignore')] = entry
    }
    const output = snapshot(join(dir, platform))
    expect(Object.keys(output).sort()).toEqual([...Object.keys(expected), ...files].sort())
    expect(output).toMatchObject(expected)
  })

  it('renames gitignore to .gitignore, drops the manifest, leaves no placeholders', async () => {
    const dir = project()
    await cli(['init', platform, ...values], dir)
    const files = listing(join(dir, platform))
    expect(files).toContain('.gitignore')
    expect(files.filter((f) => f.split('/').pop() === 'gitignore')).toEqual([])
    expect(files).not.toContain('inertia-native-template.json')
    for (const file of files) {
      const full = join(dir, platform, file)
      if (statSync(full).isDirectory() || file.endsWith('.jar')) continue
      expect(readFileSync(full, 'utf8'), file).not.toMatch(/__(APP_NAME|BUNDLE_ID|BASE_URL)__/)
    }
  })
})

it('runs as an executable bin', () => {
  expect(statSync(BIN).mode & 0o111).toBe(0o111)
  expect(readFileSync(BIN, 'utf8')).toMatch(/^#!\/usr\/bin\/env node\n/)
  const dir = project('acme-shop', { artisan: '' })
  const stdout = execFileSync(BIN, ['init', 'ios', '--skip-install'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  expect(stdout).toContain('✓ Created ios/')
  expect(stdout).toContain('then run: npm run ios')
})

it('npm pack ships the bin and the complete templates', () => {
  const [{ files }] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8' }))
  const paths = files.map((f) => f.path)
  const bin = readdirSync(join(ROOT, 'bin')).map((f) => `bin/${f}`)
  expect(bin).toContain('bin/inertia-native.mjs')
  for (const path of [
    ...bin,
    'templates/ios/gitignore',
    'templates/android/gitignore',
    'templates/android/gradlew',
    'templates/android/gradle/wrapper/gradle-wrapper.jar',
  ]) {
    expect(paths).toContain(path)
  }
  const shipped = paths.filter((p) => /^templates\/(ios|android)\//.test(p)).sort()
  const onDisk = ['ios', 'android'].flatMap((p) =>
    readdirSync(join(ROOT, 'templates', p), { recursive: true })
      .filter((f) => !statSync(join(ROOT, 'templates', p, f)).isDirectory())
      .map((f) => `templates/${p}/${f}`),
  )
  expect(shipped).toEqual(onDisk.sort())
  expect(files.find((f) => f.path === 'templates/android/gradlew').mode & 0o111).toBe(0o111)
  expect(files.find((f) => f.path === 'bin/inertia-native.mjs').mode & 0o111).toBe(0o111)
}, 30_000)

it('ships the official Gradle 9.4.1 wrapper and pins its distribution checksum', () => {
  // Checksums from services.gradle.org/distributions/gradle-9.4.1-{bin.zip,wrapper.jar}.sha256
  const wrapper = join(ROOT, 'templates', 'android', 'gradle', 'wrapper')
  const properties = readFileSync(join(wrapper, 'gradle-wrapper.properties'), 'utf8')
  expect(properties).toContain('distributions/gradle-9.4.1-bin.zip')
  expect(properties).toContain('distributionSha256Sum=2ab2958f2a1e51120c326cad6f385153bb11ee93b3c216c5fccebfdfbb7ec6cb')
  const jar = createHash('sha256').update(readFileSync(join(wrapper, 'gradle-wrapper.jar'))).digest('hex')
  expect(jar).toBe('55243ef57851f12b070ad14f7f5bb8302daceeebc5bce5ece5fa6edb23e1145c')
})
