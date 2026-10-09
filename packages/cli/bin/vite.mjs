// Makes Vite put localhost script URLs in the page, for Android. On macOS
// Vite binds `localhost` to [::1], and laravel-vite-plugin and
// rails-vite-plugin then put http://[::1]:5173 script URLs in the page, which
// Android can't load: the app shows a blank page. `server.hmr.host` changes
// only those URLs, not where Vite listens, so Docker setups like Sail keep
// working; `adb reverse` takes the device's localhost to Vite. Same rules as
// the entrypoint patch: idempotent, keeps the file's style, refuses whenever
// the result could be wrong.
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const HMR_HOST = 'localhost'

// Vite's own lookup order.
const CONFIG_FILES = ['vite.config.js', 'vite.config.mjs', 'vite.config.ts', 'vite.config.cjs', 'vite.config.mts', 'vite.config.cts']

/**
 * The Vite config file to change, if the app needs the change. vite_ruby
 * apps (config/vite.json) don't: Rails proxies Vite under relative URLs, and
 * `adb reverse` reaches Vite's HMR port on [::1] too.
 * @param {string} root
 * @returns {string | undefined}
 */
export function findViteConfig(root) {
  if (existsSync(join(root, 'config', 'vite.json'))) return undefined
  const file = CONFIG_FILES.find((name) => existsSync(join(root, name)))
  return file && join(root, file)
}

/**
 * Sets server.hmr.host to localhost in a Vite config whose `export default`
 * is an object, `defineConfig({…})` or `defineConfig((…) => ({…}))`, adding
 * `server` and `hmr` as first entries where they're missing.
 * @param {string} source
 * @returns {import('./entrypoint.mjs').PatchResult}
 */
export function patchViteConfig(source) {
  const code = maskCode(source)
  if (code === undefined) return unpatchable('it has an unterminated string, comment or bracket')
  const open = configObject(code)
  if (typeof open === 'string') return unpatchable(open)

  const quote = source.match(/^import\s[^'"]*(['"])/m)?.[1] ?? "'"
  const result = setPath(source, code, open, ['server', 'hmr', 'host'], `${quote}${HMR_HOST}${quote}`)
  if (result.status === 'patched' && patchViteConfig(result.contents).status !== 'already_patched') {
    return unpatchable("the change couldn't be checked")
  }
  return result
}

/** Entries that may set any key. @param {Entry} entry */
const unclear = (entry) => entry.kind === 'spread' || entry.kind === 'computed' || entry.kind === 'other'

/** Page URL hosts that `adb reverse` takes to this machine. @param {string | undefined} host */
const reachable = (host) => host === HMR_HOST || host === '127.0.0.1'

/**
 * Sets the property at `path` to `value` in the object literal opening at
 * `open`, adding the objects on the way that are missing.
 * @param {string} source
 * @param {string} code `source` masked by maskCode
 * @param {number} open
 * @param {string[]} path
 * @param {string} value literal to insert
 * @param {string[]} [parents] keys walked so far, for messages
 * @returns {import('./entrypoint.mjs').PatchResult}
 */
function setPath(source, code, open, path, value, parents = []) {
  const object = readObject(source, code, open)
  const name = parents.length ? `${parents.join('.')} option` : 'config object'
  if (!object) return unpatchable(`its ${name} couldn't be read`)
  if (object.entries.some(unclear)) return unpatchable(`its ${name} spreads in other objects or has computed keys or methods`)
  const [key, ...rest] = path
  const dotted = [...parents, key].join('.')
  const found = object.entries.filter((e) => e.key === key)
  if (found.length > 1) return unpatchable(`it sets ${dotted} more than once`)
  if (!found.length) {
    const entry = path.slice(0, -1).reduceRight((inner, outer) => `${outer}: { ${inner} }`, `${path.at(-1)}: ${value}`)
    return insertFirst(source, code, object, entry, source.includes('\r\n') ? '\r\n' : '\n')
  }

  const entry = found[0]
  if (!rest.length) {
    const current = entry.kind === 'property' ? source.slice(entry.value, entry.end).trim() : key
    if (reachable(current.match(/^(['"])([^'"]*)\1$/)?.[2])) return { status: 'already_patched' }
    return unpatchable(`it already sets ${dotted} to ${current}`)
  }
  const nested = entry.kind === 'property' && code[entry.value] === '{' && readObject(source, code, entry.value)
  if (!nested || code.slice(nested.close + 1, entry.end).trim()) return unpatchable(`its ${dotted} option isn't written out as an object`)
  return setPath(source, code, entry.value, rest, value, [...parents, key])
}

/**
 * Adds `entry` as the first entry of an object: on its own line, indented
 * like the next one, when entries sit on their own lines; else inline.
 * @param {string} source
 * @param {string} code
 * @param {{ open: number, close: number, entries: Entry[] }} object
 * @param {string} entry
 * @param {string} eol
 * @returns {import('./entrypoint.mjs').PatchResult}
 */
function insertFirst(source, code, { open, close, entries }, entry, eol) {
  const newline = code.indexOf('\n', open)
  const lineEnd = newline === -1 ? source.length : code[newline - 1] === '\r' ? newline - 1 : newline
  if (!entries.length) {
    if (close > lineEnd) return unpatchable('it has an empty object spread over several lines')
    return { status: 'patched', contents: `${source.slice(0, open + 1)} ${entry} ${source.slice(close)}` }
  }
  const first = entries[0].start
  if (first < lineEnd) return { status: 'patched', contents: `${source.slice(0, first)}${entry}, ${source.slice(first)}` }
  const indent = /** @type {RegExpMatchArray} */ (source.slice(source.lastIndexOf('\n', first - 1) + 1).match(/^[ \t]*/))[0]
  return { status: 'patched', contents: `${source.slice(0, lineEnd)}${eol}${indent}${entry},${source.slice(lineEnd)}` }
}

/**
 * The `{` of the object `export default` hands to Vite, or why there's none.
 * @param {string} code
 * @returns {number | string}
 */
function configObject(code) {
  const exports = [...code.matchAll(/(?<![\w$.])export\s+default\s+/g)]
  if (exports.length !== 1) return exports.length ? 'it has more than one export default' : 'it has no export default'
  let i = /** @type {number} */ (exports[0].index) + exports[0][0].length
  const call = code.slice(i).match(/^defineConfig\s*\(\s*/)
  if (!call) return code[i] === '{' ? i : "its export default isn't an object or defineConfig(…)"
  i += call[0].length
  if (code[i] === '{') return i
  const arrow = code.slice(i).match(/^(?:async\s+)?(?:\([^()]*\)|[\w$]+)\s*=>\s*(\(\s*)?/)
  if (arrow && code[i + arrow[0].length] === '{') {
    return arrow[1] ? i + arrow[0].length : 'defineConfig() gets a function with a body'
  }
  return "defineConfig() doesn't get an object literal"
}

/**
 * @typedef {{ key?: string, kind: 'property' | 'shorthand' | 'spread' | 'computed' | 'other', start: number, value: number, end: number }} Entry
 *   `value` is where a property's value starts; `end` is the `,` or `}` after the entry.
 */

/**
 * The top-level entries of the object literal opening at `open`.
 * @param {string} source
 * @param {string} code
 * @param {number} open
 * @returns {{ open: number, close: number, entries: Entry[] } | undefined}
 */
function readObject(source, code, open) {
  /** @type {Entry[]} */
  const entries = []
  const skip = (/** @type {number} */ i) => {
    while (i < code.length && /\s/.test(code[i])) i++
    return i
  }
  for (let i = skip(open + 1); ; i = skip(i)) {
    if (i >= code.length) return undefined
    if (code[i] === '}') return { open, close: i, entries }
    const start = i
    /** @type {Entry['kind'] | undefined} */
    let kind
    /** @type {string | undefined} */
    let key
    if (code.startsWith('...', i)) kind = 'spread'
    else if (code[i] === '[') kind = 'computed'
    else if (code[i] === '"' || code[i] === "'") {
      const close = code.indexOf(code[i], i + 1)
      key = source.slice(i + 1, close)
      i = close + 1
    } else {
      key = code.slice(i).match(/^[\w$]+/)?.[0]
      if (!key) return undefined
      i += key.length
    }
    let value = -1
    if (!kind) {
      const next = skip(i)
      if (code[next] === ':') {
        kind = 'property'
        value = skip(next + 1)
      } else kind = code[next] === ',' || code[next] === '}' ? 'shorthand' : 'other'
    }
    const end = entryEnd(code, kind === 'property' ? value : i)
    if (end < 0) return undefined
    entries.push({ key, kind, start, value, end })
    i = code[end] === ',' ? end + 1 : end
  }
}

/**
 * The `,` or closing `}` that ends the entry going on at `i`.
 * @param {string} code
 * @param {number} i
 */
function entryEnd(code, i) {
  let depth = 0
  for (; i < code.length; i++) {
    const c = code[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return c === '}' ? i : -1
      depth--
    } else if (c === ',' && depth === 0) return i
  }
  return -1
}

/**
 * `source` with comments and the insides of strings, template literals and
 * regular expressions blanked out (quotes and line breaks kept), so brackets
 * and keys can be found by position. Undefined when something isn't closed.
 * @param {string} source
 * @returns {string | undefined}
 */
export function maskCode(source) {
  const out = source.split('')
  const blank = (/** @type {number} */ from, /** @type {number} */ to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '
  }
  const n = source.length
  /** Bracket depths at which a template literal goes on after `${…}`. */
  const templates = /** @type {number[]} */ ([])
  let depth = 0
  let previous = '' // last code character, to tell a regex from a division

  /** Skips template text from `start`; returns where code resumes, or -1. @param {number} start */
  const template = (start) => {
    for (let j = start; j < n; j++) {
      if (source[j] === '\\') j++
      else if (source[j] === '`') {
        blank(start, j)
        return j + 1
      } else if (source[j] === '$' && source[j + 1] === '{') {
        blank(start, j)
        templates.push(++depth)
        return j + 2
      }
    }
    return -1
  }

  for (let i = 0; i < n; ) {
    const c = source[i]
    if (c === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i)
      blank(i, end === -1 ? n : end)
      i = end === -1 ? n : end
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      if (end === -1) return undefined
      blank(i, end + 2)
      i = end + 2
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1
      if (source[j] !== c) return undefined
      blank(i + 1, j)
      previous = c
      i = j + 1
    } else if (c === '`' || (c === '}' && templates.at(-1) === depth)) {
      if (c === '}') {
        templates.pop()
        depth--
      }
      i = template(i + 1)
      if (i < 0) return undefined
      previous = '`'
    } else if (c === '/' && (previous === '' || '(,=:[!&|?{};'.includes(previous))) {
      let j = i + 1
      let inClass = false
      for (; j < n && source[j] !== '\n'; j++) {
        if (source[j] === '\\') j++
        else if (source[j] === '[') inClass = true
        else if (source[j] === ']') inClass = false
        else if (source[j] === '/' && !inClass) break
      }
      if (source[j] !== '/') return undefined
      blank(i + 1, j)
      previous = '/'
      i = j + 1
    } else {
      if (c === '{' || c === '(' || c === '[') depth++
      else if (c === '}' || c === ')' || c === ']') depth--
      if (depth < 0) return undefined
      if (!/\s/.test(c)) previous = c
      i++
    }
  }
  return depth === 0 && !templates.length ? out.join('') : undefined
}

/**
 * @param {string} reason
 * @returns {import('./entrypoint.mjs').PatchResult}
 */
function unpatchable(reason) {
  return { status: 'unpatchable', reason }
}
