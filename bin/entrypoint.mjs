// Finds the Inertia entrypoint and adds the inertia-native setup to it.
// The patch rules are a port of the Laravel installer's EntrypointPatcher
// (inertia-native/laravel, src/Installer/EntrypointPatcher.php), plus quote
// style: the import uses the quotes of the import it follows.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

export const SEARCH_DIRS = ['resources/js', 'app/frontend', 'app/javascript', 'src']
export const MANUAL_LINES = ["import { initInertiaNative } from 'inertia-native'", 'initInertiaNative() // before createInertiaApp(...)']

const SOURCE = /\.(?:[cm]?[jt]sx?)$/
const SKIP_FILE = /\.d\.[cm]?ts$|\.(?:test|spec)\.[cm]?[jt]sx?$/
const SKIP_DIR = new Set(['node_modules', '__tests__', 'dist', 'build', 'public'])
const CALL = /\bcreateInertiaApp\s*\(/
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
      if (basename(file).startsWith('ssr.') || file.split(/[\\/]/).includes('ssr')) continue
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
 * Adds `import { initInertiaNative } from 'inertia-native'` right after the
 * createInertiaApp import and `initInertiaNative()` on its own line before
 * the statement that calls createInertiaApp(. Refuses whenever the result
 * could be wrong, so it never breaks the file.
 * @param {string} source
 * @returns {PatchResult}
 */
export function patchEntrypoint(source) {
  const hasImport = /^[ \t]*import\s*\{[^}]*\binitInertiaNative\b[^}]*\}\s*from\s*['"]inertia-native['"]/m.test(source)
  const hasCall = /^[ \t]*initInertiaNative\s*\(/m.test(source)

  if (hasImport && hasCall) return { status: 'already_patched' }
  if (hasImport || hasCall) return unpatchable('it is partially set up for inertia-native')

  const calls = [...source.matchAll(/\bcreateInertiaApp\s*\(/g)]
  if (calls.length !== 1) {
    return unpatchable(calls.length === 0 ? 'no createInertiaApp( call was found' : 'more than one createInertiaApp( call was found')
  }

  const eol = source.includes('\r\n') ? '\r\n' : '\n'

  // Static import statements at the start of a line, single- or multi-line.
  const imports = [...source.matchAll(/^import\s[\s\S]*?['"][^'"\r\n]+['"][ \t]*;?(?=[ \t]*\r?$)/gm)]
  if (imports.length === 0) return unpatchable('no import statements were found')

  // Prefer the line right after the import of createInertiaApp; fall back to the last import.
  const anchor = imports.find((match) => /\bcreateInertiaApp\b/.test(match[0])) ?? imports[imports.length - 1]
  const semicolon = anchor[0].endsWith(';') ? ';' : ''
  const quote = /** @type {RegExpMatchArray} */ (anchor[0].match(/(['"])[^'"\r\n]+\1[ \t]*;?$/))[1]
  const importOffset = /** @type {number} */ (anchor.index) + anchor[0].length

  // The call goes on its own line before the statement holding createInertiaApp(.
  const callOffset = /** @type {number} */ (calls[0].index)
  const lineStart = source.lastIndexOf('\n', callOffset - 1) + 1
  const indent = source
    .slice(lineStart, callOffset)
    .match(/^([ \t]*)(?:(?:export\s+default|void|await|return)\s+|(?:const|let|var)\s+[\w$]+\s*=\s*(?:await\s+)?)?$/)

  if (!indent) return unpatchable('createInertiaApp( does not start its own statement')
  if (continuesPreviousLine(source, lineStart)) return unpatchable('the createInertiaApp( line continues the previous line')
  if (callOffset < importOffset) return unpatchable('createInertiaApp( is called before the imports end')

  const line = `import { initInertiaNative } from ${quote}inertia-native${quote}${semicolon}`
  const contents =
    source.slice(0, importOffset) +
    eol +
    line +
    source.slice(importOffset, lineStart) +
    `${indent[1]}initInertiaNative()${semicolon}${eol}${eol}` +
    source.slice(lineStart)

  return { status: 'patched', contents }
}

/**
 * Whether the previous code line (skipping blank and comment lines) ends in
 * an operator, i.e. the statement carries on into the next line.
 * @param {string} source
 * @param {number} lineStart
 */
function continuesPreviousLine(source, lineStart) {
  const lines = source.slice(0, lineStart).split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line === '' || /^(\/\/|\/\*|\*)/.test(line)) continue
    return /(?:[=(,[?:&|+-]|[^*/]\*)$/.test(line)
  }
  return false
}

/**
 * @param {string} reason
 * @returns {PatchResult}
 */
function unpatchable(reason) {
  return { status: 'unpatchable', reason }
}
