import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findViteConfig, maskCode, patchViteConfig } from '../bin/vite.mjs'

// The Laravel React starter kit's vite.config.ts, shortened.
const LARAVEL = `import laravel from 'laravel-vite-plugin';
import { defineConfig, lazyPlugins } from 'vite-plus';

export default defineConfig({
    plugins: lazyPlugins(() => [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.tsx'],
            refresh: true,
        }),
    ]),
    server: {
        watch: {
            ignored: ['**/.agents/**', '**/vendor/**'],
        },
    },
});
`

// The inertia-rails React starter kit's vite.config.ts (rails-vite-plugin), shortened.
const RAILS = `import rails from "rails-vite-plugin"
import { defineConfig } from "vite"

export default defineConfig(({ command }) => ({
  ssr: {
    // Prebuild ssr.js so we can drop node_modules from the container.
    noExternal: command === "build" ? true : undefined,
  },
  plugins: [rails()],
}))
`

/** Lines added by a patch. */
function added(before, result) {
  expect(result.status).toBe('patched')
  const old = before.split('\n')
  return result.contents.split('\n').filter((line) => !old.includes(line))
}

describe('patchViteConfig', () => {
  it("adds host to an existing server object (Laravel's starter kit)", () => {
    const result = patchViteConfig(LARAVEL)
    expect(added(LARAVEL, result)).toEqual(["        host: '127.0.0.1',"])
    expect(result.contents).toContain("    server: {\n        host: '127.0.0.1',\n        watch: {")
  })

  it("adds a server entry to a config arrow function's object (Rails' starter kit)", () => {
    const result = patchViteConfig(RAILS)
    expect(result.contents).toContain('export default defineConfig(({ command }) => ({\n  server: { host: "127.0.0.1" },\n  ssr: {')
    expect(added(RAILS, result)).toEqual(['  server: { host: "127.0.0.1" },'])
  })

  it('handles a plain exported object, inline objects and empty ones', () => {
    expect(patchViteConfig("export default {\n\tplugins: [],\n}\n")).toEqual({
      status: 'patched',
      contents: "export default {\n\tserver: { host: '127.0.0.1' },\n\tplugins: [],\n}\n",
    })
    expect(patchViteConfig("import { defineConfig } from 'vite'\nexport default defineConfig({ plugins: [react()] })\n")).toMatchObject({
      contents: "import { defineConfig } from 'vite'\nexport default defineConfig({ server: { host: '127.0.0.1' }, plugins: [react()] })\n",
    })
    expect(patchViteConfig('export default defineConfig({ server: { port: 5180 } })')).toMatchObject({
      contents: "export default defineConfig({ server: { host: '127.0.0.1', port: 5180 } })",
    })
    expect(patchViteConfig('export default defineConfig({})')).toMatchObject({ contents: "export default defineConfig({ server: { host: '127.0.0.1' } })" })
    expect(patchViteConfig('export default defineConfig({ server: {} })')).toMatchObject({
      contents: "export default defineConfig({ server: { host: '127.0.0.1' } })",
    })
  })

  it('keeps a comment on the opening line where it is', () => {
    const source = 'export default defineConfig({ // config\n  plugins: [],\n})\n'
    expect(patchViteConfig(source)).toMatchObject({ contents: "export default defineConfig({ // config\n  server: { host: '127.0.0.1' },\n  plugins: [],\n})\n" })
  })

  it('is already patched after patching, and changes nothing then', () => {
    for (const source of [LARAVEL, RAILS]) {
      const once = patchViteConfig(source)
      expect(once.status).toBe('patched')
      expect(patchViteConfig(once.contents)).toEqual({ status: 'already_patched' })
    }
  })

  it.each([["host: '127.0.0.1'"], ['host: "127.0.0.1"'], ["host: '0.0.0.0'"], ['host: true']])('accepts an existing %s', (host) => {
    expect(patchViteConfig(`export default defineConfig({\n  server: {\n    port: 5180,\n    ${host},\n  },\n})\n`)).toEqual({ status: 'already_patched' })
  })

  it.each([
    ["export default defineConfig({ server: { host: 'localhost' } })", "it already sets server.host to 'localhost'"],
    ['export default defineConfig({ server: { host: process.env.HOST } })', 'it already sets server.host to process.env.HOST'],
    ['const server = {}\nexport default defineConfig({ server })', "its server option isn't written out as an object"],
    ['export default defineConfig({ server: serverOptions })', "its server option isn't written out as an object"],
    ['export default defineConfig({ server: { ...base } })', 'its server option spreads in other objects or has computed keys or methods'],
    ['export default defineConfig({ ...shared, plugins: [] })', 'its config object spreads in other objects or has computed keys or methods'],
    ["export default defineConfig({ ['ser' + 'ver']: {} })", 'its config object spreads in other objects or has computed keys or methods'],
    ['export default defineConfig({ get server() { return {} } })', 'its config object spreads in other objects or has computed keys or methods'],
    ['export default defineConfig({ server: {}, server: {} })', 'it sets server more than once'],
    ['export default defineConfig(({ mode }) => {\n  return { plugins: [] }\n})', 'defineConfig() gets a function with a body'],
    ['export default defineConfig(config)', "defineConfig() doesn't get an object literal"],
    ['export default mergeConfig(base, {})', "its export default isn't an object or defineConfig(…)"],
    ['module.exports = { plugins: [] }', 'it has no export default'],
    ["export default defineConfig({ plugins: ['x] })", 'it has an unterminated string, comment or bracket'],
    ['export default defineConfig({ plugins: [ })', 'it has an unterminated string, comment or bracket'],
    ['export default defineConfig({\n  server: {\n  }\n})', 'it has an empty object spread over several lines'],
  ])('leaves %j alone: %s', (source, reason) => {
    expect(patchViteConfig(source)).toEqual({ status: 'unpatchable', reason })
  })

  it('is not fooled by comments, strings, template literals or regular expressions', () => {
    const source = `// export default { server: { host: 'x' } }
import { defineConfig } from 'vite'
/* server: { */
const banner = \`server: { \${ { a: '}' }.a } \`
export default defineConfig({
  define: { BANNER: JSON.stringify(banner), CLOSE: '}', OPEN: "{" },
  plugins: [watch({ ignored: [/server: {/, /[/}]/] })],
})
`
    const result = patchViteConfig(source)
    expect(added(source, result)).toEqual(["  server: { host: '127.0.0.1' },"])
    expect(result.contents).toContain("export default defineConfig({\n  server: { host: '127.0.0.1' },\n  define:")
  })

  it('keeps CRLF line endings', () => {
    const crlf = LARAVEL.replaceAll('\n', '\r\n')
    const result = patchViteConfig(crlf)
    expect(result.status).toBe('patched')
    expect(result.contents).toBe(patchViteConfig(LARAVEL).contents.replaceAll('\n', '\r\n'))
    expect(result.contents.replaceAll('\r\n', '')).not.toContain('\n')
    expect(patchViteConfig(result.contents)).toEqual({ status: 'already_patched' })
  })
})

describe('findViteConfig', () => {
  let tmp
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'inertia-native-vite-'))
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it("follows Vite's lookup order, and skips vite_ruby apps", () => {
    expect(findViteConfig(tmp)).toBeUndefined()
    writeFileSync(join(tmp, 'vite.config.mts'), '')
    expect(findViteConfig(tmp)).toBe(join(tmp, 'vite.config.mts'))
    writeFileSync(join(tmp, 'vite.config.ts'), '')
    expect(findViteConfig(tmp)).toBe(join(tmp, 'vite.config.ts'))
    mkdirSync(join(tmp, 'config'))
    writeFileSync(join(tmp, 'config', 'vite.json'), '{}')
    expect(findViteConfig(tmp)).toBeUndefined()
  })
})

it('masks comments and literals, keeping offsets and line breaks', () => {
  const source = "a('{', `x${ {b: '}'} }y`, /}/g) // }\r\n/* { */ c"
  const masked = maskCode(source)
  expect(masked).toHaveLength(source.length)
  expect(masked).toBe("a(' ', ` ${ {b: ' '} } `, / /g)     \r\n        c")
  expect(maskCode('a(`${`')).toBeUndefined()
  expect(maskCode('/* open')).toBeUndefined()
})
