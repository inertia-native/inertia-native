// Facts about the app the CLI runs in.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { resolveCommand } from 'package-manager-detector/commands'
import { detect, resolveAgent } from 'package-manager-detector/detect'

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

/** @typedef {{ name: string, agent: import('package-manager-detector').Agent }} PackageManager */

/**
 * The package manager, from the nearest lockfile or packageManager field at
 * or above `root` (so a workspace member gets the workspace's), then the one
 * that runs this CLI (`pnpm dlx`, `yarn create`), then npm.
 * @param {string} root
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<PackageManager>}
 */
export async function packageManager(root, env) {
  const found = await detect({ cwd: root })
  if (found) return found
  const [name, version] = String(env.npm_config_user_agent).split(' ')[0].split('/')
  return resolveAgent(/** @type {import('package-manager-detector').AgentName} */ (name), version) ?? { name: 'npm', agent: 'npm' }
}

/**
 * The install command for a package spec.
 * @param {PackageManager} pm
 * @param {string} spec
 * @param {boolean} [dev] as a dev dependency
 * @returns {[string, string[]]}
 */
export function addCommand(pm, spec, dev = false) {
  const { command, args } = /** @type {import('package-manager-detector').ResolvedCommand} */ (
    resolveCommand(pm.agent, 'add', dev ? ['-D', spec] : [spec])
  )
  return [command, args]
}

/**
 * How to run a package.json script, e.g. `pnpm run ios`.
 * @param {PackageManager} pm
 * @param {string} script
 */
export function runCommand(pm, script) {
  const { command, args } = /** @type {import('package-manager-detector').ResolvedCommand} */ (resolveCommand(pm.agent, 'run', [script]))
  return [command, ...args].join(' ')
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
