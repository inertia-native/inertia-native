// `inertia-native init [ios|android|both]`: adds inertia-native to an Inertia
// app: npm package, entrypoint patch, Vite host for Android, native shells,
// package.json scripts. Every step is idempotent.
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { findEntrypoints, MANUAL_LINES, patchEntrypoint, SEARCH_DIRS } from './entrypoint.mjs'
import { addCommand, defaultUrl, devCommand, findProjectRoot, packageManager, readPackageJson, writePackageJson } from './project.mjs'
import { createPrompter } from './prompt.mjs'
import { bundleIdFromName, invalid, nameFromDirectory, PLATFORMS, RULES, TEMPLATES, writeShell } from './shell.mjs'
import { findViteConfig, patchViteConfig, VITE_HOST } from './vite.mjs'

export const PACKAGE = 'inertia-native'

export const INIT_USAGE = `Usage: npx inertia-native init [ios|android|both] [options]

Sets up inertia-native in your Inertia app (the directory with package.json):
adds the npm package, patches the file that calls createInertiaApp(),
creates the native shells ios/ and android/, and adds "ios" and "android"
scripts to package.json. For Android it also offers to set server.host to
127.0.0.1 in your Vite config: Android can't load scripts from Vite at
[::1], its default address on macOS. In a terminal it asks for anything not
given as a flag. Safe to re-run.

Options:
  --name <name>        Name under the app icon.
                       Default: the directory name, title-cased (acme-shop -> Acme Shop)
  --bundle-id <id>     iOS bundle ID and Android applicationId.
                       Default: com.example.<name, lowercase letters and digits>
  --url <url>          URL the app loads. Default: http://localhost:8000 if
                       ./artisan exists, otherwise http://localhost:3000
  --entrypoint <path>  File that calls createInertiaApp(). Default: searched for
                       under ${SEARCH_DIRS.join(', ')}
  --skip-install       Don't add the inertia-native npm package
  --force              Replace existing ios/ and android/ (default: skip them)
  -y, --yes            Don't ask; use the defaults and change the Vite host
  -h, --help           Show this help`

/**
 * @typedef {object} IO
 * @property {string} [cwd]
 * @property {Record<string, string | undefined>} [env]
 * @property {NodeJS.ReadableStream & { isTTY?: boolean }} [stdin]
 * @property {{ write(s: string): unknown }} [stdout]
 * @property {{ write(s: string): unknown }} [stderr]
 * @property {import('./prompt.mjs').Prompter} [prompter] Replaces the terminal prompts (tests).
 * @property {(cmd: string, args: string[], options: { cwd: string, env: Record<string, string | undefined>, detached?: boolean }) => number} [exec]
 *   Runs a command with inherited stdio and returns its exit code; `detached`
 *   starts it in the background instead (returns 0).
 * @property {string} [templates]
 * @property {NodeJS.Platform} [os] Replaces process.platform (tests).
 */

/**
 * @param {string[]} argv
 * @param {IO} io
 * @returns {Promise<number>} exit code
 */
export async function init(argv, io) {
  const { cwd = process.cwd(), env = process.env, stdin, templates = TEMPLATES } = io
  const exec = io.exec ?? (() => 1)
  const out = (/** @type {string} */ line = '') => io.stdout?.write(`${line}\n`)
  const warn = (/** @type {string} */ line) => io.stderr?.write(`${line}\n`)

  /** @param {string[]} messages */
  const abort = (messages) => {
    for (const message of messages) warn(message)
    warn('Nothing was changed.')
    return 1
  }

  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        name: { type: 'string' },
        'bundle-id': { type: 'string' },
        url: { type: 'string' },
        entrypoint: { type: 'string' },
        'skip-install': { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
        yes: { type: 'boolean', short: 'y', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    })
  } catch (error) {
    warn(/** @type {Error} */ (error).message)
    warn('Run `npx inertia-native init --help` for usage.')
    return 1
  }
  const { values: flags, positionals } = parsed

  if (flags.help) {
    out(INIT_USAGE)
    return 0
  }
  if (positionals.length > 1 || (positionals.length === 1 && !['ios', 'android', 'both'].includes(positionals[0]))) {
    warn(`Unknown platform "${positionals.join(' ')}": use ios, android or both.`)
    return 1
  }

  const root = findProjectRoot(cwd)
  if (!root) {
    warn(`No package.json in ${cwd} or any parent directory. Run this from your app's root.`)
    return 1
  }
  const show = (/** @type {string} */ path) => relative(cwd, path) || '.'

  // Flags are checked before any question or write.
  const errors = []
  for (const flag of /** @type {const} */ (['name', 'bundle-id', 'url'])) {
    const value = flags[flag]
    const error = value === undefined ? undefined : invalid(flag, value)
    if (error) errors.push(error)
  }
  const entrypointFlag = flags.entrypoint === undefined ? undefined : resolve(cwd, flags.entrypoint)
  if (entrypointFlag && !(existsSync(entrypointFlag) && statSync(entrypointFlag).isFile())) {
    errors.push(`Invalid --entrypoint ${JSON.stringify(flags.entrypoint)}: no such file.`)
  }
  if (errors.length) return abort(errors)

  const prompter = flags.yes
    ? undefined
    : (io.prompter ?? (stdin?.isTTY ? createPrompter(stdin, /** @type {NodeJS.WritableStream} */ (io.stdout)) : undefined))

  /** @param {string} label @param {string} value @param {string} hint */
  const report = (label, value, hint) => {
    out(`✓ ${label}: ${value} (${hint})`)
    return value
  }

  // Questions first, so nothing is written until all answers are in.
  let platforms, entrypoint, values, vite
  try {
    // 1. Platforms
    const choice = positionals[0] ?? (prompter ? await prompter.select('Platforms', ['both', 'ios', 'android'], 'both') : 'both')
    platforms = choice === 'both' ? [...PLATFORMS] : [choice]

    // 2. Entrypoint
    entrypoint = entrypointFlag
    if (!entrypoint) {
      const found = findEntrypoints(root)
      if (found.length === 1) {
        entrypoint = join(root, found[0])
        out(`✓ Found entrypoint ${show(entrypoint)}`)
      } else if (found.length > 1) {
        const picked = prompter ? await prompter.select('Which file is your Inertia entrypoint?', found, found[0]) : found[0]
        entrypoint = join(root, picked)
        if (!prompter) out(`✓ Found entrypoint ${show(entrypoint)} (also: ${found.slice(1).join(', ')}; pick one with --entrypoint)`)
      }
    }

    // Shell values, only needed when a shell will be written.
    if (platforms.some((platform) => flags.force || !existsSync(join(root, platform)))) {
      const derivedName = nameFromDirectory(basename(root))
      let name = flags.name
      if (name === undefined) {
        if (prompter) name = await prompter.text('App name', derivedName, (v) => invalid('name', v))
        else if (derivedName) name = report('App name', derivedName, '--name to change')
        else {
          return abort([
            `Can't make an app name from the directory name ${JSON.stringify(basename(root))}. Pass --name: ${RULES.name.allowed}.`,
          ])
        }
      }
      const bundleId =
        flags['bundle-id'] ??
        (prompter
          ? await prompter.text('Bundle ID', bundleIdFromName(name), (v) => invalid('bundle-id', v))
          : report('Bundle ID', bundleIdFromName(name), '--bundle-id to change'))
      const fallback = defaultUrl(root)
      const url =
        flags.url ??
        (prompter
          ? await prompter.text('Dev server URL', fallback.url, (v) => invalid('url', v))
          : report('Dev server URL', fallback.url, `${fallback.reason}; --url to change`))
      values = { name, bundleId, url }
    }

    // Vite host, for Android only.
    const viteConfig = platforms.includes('android') ? findViteConfig(root) : undefined
    if (viteConfig) {
      const result = patchViteConfig(readFileSync(viteConfig, 'utf8'))
      const apply =
        result.status === 'patched' &&
        (flags.yes ||
          (prompter ? await prompter.confirm(`Set server.host to ${VITE_HOST} in ${show(viteConfig)}, so Android can load scripts from Vite?`) : false))
      vite = { path: viteConfig, result, apply, asked: Boolean(prompter) }
    }
  } finally {
    prompter?.close()
  }

  let failed = false
  const pm = packageManager(root)

  // 3. Package
  const pkg = readPackageJson(root)
  if (pkg.data.dependencies?.[PACKAGE] || pkg.data.devDependencies?.[PACKAGE]) {
    out(`✓ ${PACKAGE} is already in package.json`)
  } else {
    const [cmd, args] = addCommand(pm, installSpec(env, cwd))
    const command = [cmd, ...args].join(' ')
    if (flags['skip-install']) {
      warn(`! Skipped adding ${PACKAGE} (--skip-install). Add it with: ${command}`)
    } else {
      out(`› ${command}`)
      const childEnv = { ...env }
      delete childEnv.npm_config_package // set by `npx --package`, not meant for the install
      if (exec(cmd, args, { cwd: root, env: childEnv }) === 0) {
        out(`✓ Added ${PACKAGE} to package.json (${pm})`)
      } else {
        warn(`✗ Couldn't add ${PACKAGE}. Run this yourself: ${command}`)
        failed = true
      }
    }
  }

  // 4. Patch
  if (entrypoint) {
    const result = patchEntrypoint(readFileSync(entrypoint, 'utf8'))
    if (result.status === 'patched') {
      writeFileSync(entrypoint, result.contents)
      out(`✓ Patched ${show(entrypoint)}`)
    } else if (result.status === 'already_patched') {
      out(`✓ ${show(entrypoint)} already calls initInertiaNative()`)
    } else {
      manual(`! Couldn't patch ${show(entrypoint)}: ${result.reason}. Add these two lines to it by hand:`)
    }
  } else {
    manual(
      `! Found no file calling createInertiaApp( under ${SEARCH_DIRS.join(', ')}. ` +
        'Add these two lines to your Inertia entrypoint by hand (or pass --entrypoint):',
    )
  }

  // 5. Vite host
  if (vite) {
    const file = show(vite.path)
    const { result } = vite
    const why = `Android can't load scripts from Vite at [::1], its default address on macOS`
    if (result.status === 'patched' && vite.apply) {
      writeFileSync(vite.path, result.contents)
      out(`✓ Set server.host to ${VITE_HOST} in ${file}`)
    } else if (result.status === 'already_patched') {
      out(`✓ ${file} already sets server.host`)
    } else if (result.status === 'patched') {
      warn(`! ${why}. For Android, set server.host to '${VITE_HOST}' in ${file}${vite.asked ? '' : ' (or re-run with --yes)'}.`)
    } else {
      warn(`! Couldn't change ${file}: ${result.reason}. ${why}; for Android, set server.host to '${VITE_HOST}' there by hand.`)
    }
  }

  // 6. Shells
  const written = []
  for (const platform of platforms) {
    const target = join(root, platform)
    if (existsSync(target) && !flags.force) {
      warn(`! Skipped ${show(target)}/: it already exists (--force replaces it)`)
      continue
    }
    const replaced = existsSync(target)
    if (replaced) rmSync(target, { recursive: true })
    writeShell(join(templates, platform), target, /** @type {NonNullable<typeof values>} */ (values))
    written.push(`${show(target)}/${replaced ? ' (replaced)' : ''}`)
  }
  if (written.length) out(`✓ Created ${written.join(' and ')}`)

  // 7. Scripts
  const after = readPackageJson(root)
  const scripts = (after.data.scripts ??= {})
  const added = []
  for (const platform of platforms) {
    const script = `inertia-native run ${platform}`
    if (scripts[platform] === undefined) {
      scripts[platform] = script
      added.push(`"${platform}"`)
    } else if (scripts[platform] !== script) {
      warn(`! Kept your own "${platform}" script; use \`npx inertia-native run ${platform}\` to run the app`)
    }
  }
  if (added.length) {
    writePackageJson(after)
    out(`✓ Added ${added.join(' and ')} script${added.length > 1 ? 's' : ''} to package.json`)
  } else if (platforms.every((platform) => scripts[platform] === `inertia-native run ${platform}`)) {
    out('✓ package.json already has the scripts')
  }

  // 8. Next step
  const dev = devCommand(root)
  const [first, ...others] = platforms.map((platform) => `${pm} run ${platform}`)
  out()
  out(`Next: start your dev server${dev ? ` (${dev})` : ''}, then run: ${first}${others.length ? ` (or ${others.join(', ')})` : ''}`)
  return failed ? 1 : 0

  /** @param {string} message */
  function manual(message) {
    warn(message)
    warn('')
    for (const line of MANUAL_LINES) warn(`    ${line}`)
    warn('')
  }
}

/**
 * What to install: the package that `npx --package <spec>` ran this CLI from
 * (a tarball or a version), else inertia-native from the registry.
 * @param {Record<string, string | undefined>} env
 * @param {string} cwd
 */
export function installSpec(env, cwd) {
  const spec = env.npm_config_package
  if (env.npm_command !== 'exec' || !spec || /[\s,]/.test(spec)) return PACKAGE
  if (/^inertia-native@[\w.^~<>=*-]+$/.test(spec)) return spec
  if (/\.(tgz|tar\.gz)$/.test(spec)) return /^https?:\/\//.test(spec) ? spec : resolve(cwd, spec.replace(/^file:/, ''))
  return PACKAGE
}
