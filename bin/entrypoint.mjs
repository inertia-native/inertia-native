// Finds the Inertia entrypoint and adds the inertia-native setup to it.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'

export const SEARCH_DIRS = ['resources/js', 'app/frontend', 'app/javascript', 'src']
export const MANUAL_LINES = ["import { initInertiaNative } from 'inertia-native'", 'initInertiaNative() // before createInertiaApp(...)']

const SOURCE = /\.(?:[cm]?[jt]sx?)$/
const SKIP_FILE = /\.d\.[cm]?ts$|\.(?:test|spec)\.[cm]?[jt]sx?$/
const SKIP_DIR = new Set(['node_modules', '__tests__', 'dist', 'build', 'public'])
const CALL = /\bcreateInertiaApp\s*\(/
const IMPORT = /^(import\s+(?:[\w$*,\s]*\{[^}]*\}[\w$,\s]*from\s*|[\w$*,\s]*?from\s*)?(['"])[^'"\r\n]+\2[ \t]*(;?))[ \t]*(?:\/\/.*?)?(?=\r?$)/gm
const SSR_IMPORT = /from\s*['"](?:@inertiajs\/[\w-]+\/server|react-dom\/server|vue\/server-renderer|svelte\/server)['"]/

/**
 * Files under the usual frontend directories that call createInertiaApp(),
 * relative to `root`, in search order. SSR entrypoints are left out.
 * @param {string} root
 * @returns {string[]}
 */
export function findEntrypoints(root) {
  const found = []
  for (const dir of SEARCH_DIRS) {
    const base = join(root, dir)
    if (!existsSync(base) || !statSync(base).isDirectory()) continue
    const files = walk(base).sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))
    for (const file of files) {
      if (basename(file).startsWith('ssr.') || relative(base, file).split(/[\\/]/).includes('ssr')) continue
      const source = readFileSync(file, 'utf8')
      if (CALL.test(source) && !SSR_IMPORT.test(source)) found.push(relative(root, file))
    }
  }
  return found
}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIR.has(entry.name)) files.push(...walk(path))
    } else if (entry.isFile() && SOURCE.test(entry.name) && !SKIP_FILE.test(entry.name)) {
      if (statSync(path).size < 512 * 1024) files.push(path)
    }
  }
  return files
}

/** @param {string} path */
const depth = (path) => path.split(/[\\/]/).length

/**
 * @typedef {{ status: 'patched', contents: string }
 *   | { status: 'already_patched' }
 *   | { status: 'unpatchable', reason: string }} PatchResult
 */

/**
 * Adds `import './inertia-native'` right after the createInertiaApp import;
 * `initializer` writes that file. A file's imports run before its own code,
 * so where createInertiaApp( is called doesn't matter.
 * @param {string} source
 * @returns {PatchResult}
 */
export function patchEntrypoint(source) {
  const hasSetup = /^[ \t]*import\s*['"]\.\/inertia-native['"]/m.test(source)
  const hasImport = /^[ \t]*import\s*\{[^}]*\binitInertiaNative\b[^}]*\}\s*from\s*['"]inertia-native['"]/m.test(source)
  const hasCall = /^[ \t]*initInertiaNative\s*\(/m.test(source)

  if (hasSetup || (hasImport && hasCall)) return { status: 'already_patched' }
  if (hasImport || hasCall) return unpatchable('it is partially set up for inertia-native')
  if (!CALL.test(source)) return unpatchable('no createInertiaApp( call was found')

  // Static import statements at the start of a line, single- or multi-line,
  // with any comment after them on the line.
  const imports = [...source.matchAll(IMPORT)]
  if (imports.length === 0) return unpatchable('no import statements were found')

  // Prefer the line right after the import of createInertiaApp; fall back to the last import.
  const anchor = imports.find((match) => /\bcreateInertiaApp\b/.test(match[1])) ?? imports[imports.length - 1]
  const [, , quote, semicolon] = anchor
  const offset = /** @type {number} */ (anchor.index) + anchor[0].length
  const eol = source.includes('\r\n') ? '\r\n' : '\n'

  const line = `import ${quote}./inertia-native${quote}${semicolon}`
  return { status: 'patched', contents: source.slice(0, offset) + eol + line + source.slice(offset) }
}

/**
 * The setup file the patched entrypoint imports: next to it, in its language
 * and with its quotes and semicolons.
 * @param {string} entrypoint path
 * @param {string} source the entrypoint's contents
 * @returns {{ path: string, contents: string }}
 */
export function initializer(entrypoint, source) {
  const [, , quote = "'", semicolon = ''] = [...source.matchAll(IMPORT)][0] ?? []
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const ts = /^\.[cm]?tsx?$/.test(extname(entrypoint))
  const lines = [
    `import { initInertiaNative } from ${quote}inertia-native${quote}${semicolon}`,
    '',
    "// Lets the iOS and Android apps drive Inertia's navigation; does nothing in",
    '// a regular browser. Options: https://inertia-native.dev',
    `initInertiaNative()${semicolon}`,
  ]
  return { path: join(dirname(entrypoint), `inertia-native.${ts ? 'ts' : 'js'}`), contents: lines.join(eol) + eol }
}

/**
 * @param {string} reason
 * @returns {PatchResult}
 */
function unpatchable(reason) {
  return { status: 'unpatchable', reason }
}
