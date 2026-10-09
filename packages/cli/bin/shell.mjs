// Native shell templates: value rules, defaults and the copy itself, per
// templates/CONTRACT.md.
import { cpSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TEMPLATES = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'templates')
export const PLATFORMS = /** @type {const} */ (['ios', 'android'])
const MANIFEST = 'inertia-native-template.json'

// Values are validated so that no escaping is ever needed in the templates.
export const RULES = {
  name: {
    pattern: /^[A-Za-z0-9][A-Za-z0-9 .-]{0,29}$/,
    allowed: '1-30 letters, digits, spaces, dots or dashes, starting with a letter or digit',
  },
  'bundle-id': {
    pattern: /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/,
    allowed:
      'lowercase reverse-DNS like com.acme.app: two or more parts, each starting with a letter, only a-z and 0-9 (no "-" or "_")',
  },
  url: {
    pattern: /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~-]+)*$/,
    allowed: 'http:// or https://, a host, an optional :port and path, no trailing slash or query (e.g. http://localhost:8000)',
  },
}

/**
 * Error message for an invalid value, or undefined when it's fine.
 * @param {keyof typeof RULES} flag
 * @param {string} value
 */
export function invalid(flag, value) {
  if (RULES[flag].pattern.test(value)) return undefined
  return `Invalid --${flag} ${JSON.stringify(value)}: use ${RULES[flag].allowed}.`
}

/**
 * `acme-shop` -> `Acme Shop`. Splits on anything but ASCII letters and digits
 * (accents are dropped first), capitalises each word and keeps whole words
 * up to the 30-character limit. Returns '' if nothing usable is left.
 * @param {string} dir
 */
export function nameFromDirectory(dir) {
  const words = dir
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
  let name = ''
  for (const word of words) {
    const next = name ? `${name} ${word}` : word
    if (next.length > 30) return name || word.slice(0, 30)
    name = next
  }
  return name
}

/**
 * `Acme Shop` -> `com.example.acmeshop`; a leading digit gets an `app` prefix.
 * @param {string} name
 */
export function bundleIdFromName(name) {
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  return `com.example.${/^[0-9]/.test(id) ? `app${id}` : id}`
}

/**
 * Copies one template into `target` (which must not exist), filling in the
 * values.
 * @param {string} source
 * @param {string} target
 * @param {{ name: string, bundleId: string, url: string }} values
 */
export function writeShell(source, target, { name, bundleId, url }) {
  const manifest = JSON.parse(readFileSync(join(source, MANIFEST), 'utf8'))
  cpSync(source, target, { recursive: true })
  rmSync(join(target, MANIFEST))

  // npm drops `.gitignore` from packages, so templates ship them as `gitignore`.
  for (const file of readdirSync(target, { recursive: true, encoding: 'utf8' })) {
    if (basename(file) === 'gitignore') {
      renameSync(join(target, file), join(target, dirname(file), '.gitignore'))
    }
  }

  const replacements = { __APP_NAME__: name, __BUNDLE_ID__: bundleId, __BASE_URL__: url }
  for (const file of manifest.files) {
    const path = join(target, file)
    let content = readFileSync(path, 'utf8')
    for (const [placeholder, value] of Object.entries(replacements)) {
      content = content.replaceAll(placeholder, value)
    }
    writeFileSync(path, content)
  }
}
