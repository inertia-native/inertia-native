// Facts about the app the CLI runs in.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * The nearest directory at or above `dir` that has a package.json.
 * @param {string} dir
 * @returns {string | undefined}
 */
export function findProjectRoot(dir) {
  for (let current = resolve(dir); ; current = dirname(current)) {
    if (existsSync(join(current, 'package.json'))) return current
    if (dirname(current) === current) return undefined
  }
}

/**
 * Default dev server URL and why.
 * @param {string} root
 */
export function defaultUrl(root) {
  if (existsSync(join(root, 'artisan'))) return { url: 'http://localhost:8000', reason: 'found artisan' }
  if (existsSync(join(root, 'bin', 'rails'))) return { url: 'http://localhost:3000', reason: 'found bin/rails' }
  return { url: 'http://localhost:3000', reason: 'default' }
}

/**
 * How the user starts their dev server, for the "next step" hint.
 * @param {string} root
 */
export function devCommand(root) {
  if (existsSync(join(root, 'bin', 'dev'))) return 'bin/dev'
  if (existsSync(join(root, 'artisan'))) return 'composer run dev'
  return undefined
}

/** @typedef {'npm' | 'pnpm' | 'yarn' | 'bun'} PackageManager */

/**
 * The package manager, from the lockfile (then the packageManager field).
 * @param {string} root
 * @returns {PackageManager}
 */
export function packageManager(root) {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb'))) return 'bun'
  if (existsSync(join(root, 'package-lock.json'))) return 'npm'
  const field = String(readPackageJson(root).data.packageManager ?? '')
  const name = field.split('@')[0]
  return name === 'pnpm' || name === 'yarn' || name === 'bun' ? name : 'npm'
}

/**
 * The install command for a package spec.
 * @param {PackageManager} pm
 * @param {string} spec
 * @param {boolean} [dev] as a dev dependency
 * @returns {[string, string[]]}
 */
export function addCommand(pm, spec, dev = false) {
  return [pm, [pm === 'npm' ? 'install' : 'add', ...(dev ? ['-D'] : []), spec]]
}

/**
 * package.json plus what's needed to write it back in the same style.
 * @param {string} root
 */
export function readPackageJson(root) {
  const path = join(root, 'package.json')
  const text = readFileSync(path, 'utf8')
  return {
    path,
    data: /** @type {Record<string, any>} */ (JSON.parse(text)),
    indent: text.match(/^([ \t]+)"/m)?.[1] ?? '  ',
    eol: text.includes('\r\n') ? '\r\n' : '\n',
    finalNewline: text.endsWith('\n'),
  }
}

/** @param {ReturnType<typeof readPackageJson>} pkg */
export function writePackageJson({ path, data, indent, eol, finalNewline }) {
  const text = JSON.stringify(data, null, indent).replaceAll('\n', eol)
  writeFileSync(path, finalNewline ? text + eol : text)
}
