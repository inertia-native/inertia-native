// `inertia-native open ios|android`: opens a native shell in Xcode or
// Android Studio.
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { delimiter, join, relative } from 'node:path'
import { parseArgs } from 'node:util'

import { findProjectRoot, packageManager, runCommand } from './project.mjs'
import { bakedUrl, reversePorts } from './run.mjs'

export const OPEN_USAGE = `Usage: npx inertia-native open <ios|android>

Opens ios/App.xcodeproj in Xcode, or android/ in Android Studio, to run the
app from there or work on its native code. Android Studio doesn't forward
the dev server's ports, so for Android it prints the \`adb reverse\` command
to run once per emulator boot.

Options:
  -h, --help   Show this help`

/**
 * @param {string[]} argv
 * @param {import('./init.mjs').IO} io
 * @returns {Promise<number>}
 */
export async function open(argv, io) {
  const { cwd, env, os, exec } = io
  const out = (/** @type {string} */ line) => io.stdout.write(`${line}\n`)
  const warn = (/** @type {string} */ line) => io.stderr.write(`${line}\n`)

  let parsed
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { help: { type: 'boolean', short: 'h', default: false } } })
  } catch (error) {
    warn(/** @type {Error} */ (error).message)
    warn('Run `npx inertia-native open --help` for usage.')
    return 1
  }
  if (parsed.values.help) {
    out(OPEN_USAGE)
    return 0
  }
  const [platform, ...rest] = parsed.positionals
  if (rest.length || (platform !== 'ios' && platform !== 'android')) {
    warn(platform ? `Unknown platform "${parsed.positionals.join(' ')}": use ios or android.` : OPEN_USAGE)
    return 1
  }

  const root = findProjectRoot(cwd)
  if (!root) {
    warn(`✗ No package.json in ${cwd} or any parent directory. Run this from your app's root.`)
    return 1
  }
  const marker = platform === 'ios' ? join(root, 'ios', 'App.xcodeproj') : join(root, 'android', 'gradlew')
  if (!existsSync(marker)) {
    warn(`✗ No ${platform}/ shell in ${root}. Create it with: npx inertia-native init ${platform}`)
    return 1
  }

  const target = platform === 'ios' ? marker : join(root, 'android')
  const shown = platform === 'ios' ? relative(cwd, target) : `${relative(cwd, target) || '.'}/`
  const ide = platform === 'ios' ? 'Xcode' : 'Android Studio'
  if (platform === 'ios' && os !== 'darwin') {
    warn('✗ Xcode runs on macOS only.')
    return 1
  }

  const command = ideCommand(platform, target, env, os)
  let status = 0
  if (!command) {
    out(`Open ${target} in ${ide}.`)
  } else if (exec(command[0], command[1], { cwd: root, env, detached: os !== 'darwin' }) === 0) {
    out(`✓ Opened ${shown} in ${ide}`)
  } else {
    warn(`✗ Couldn't start ${ide}. Open ${target} in it yourself.`)
    status = 1
  }

  if (platform === 'android') {
    const ports = reversePorts(root, bakedUrl(root, 'android')).ports
    if (ports.length) {
      const commands = ports.map((port) => `adb reverse tcp:${port} tcp:${port}`).join(' && ')
      warn(`! Android Studio doesn't forward ports. Once per emulator boot, run: ${commands} (or ${runCommand(await packageManager(root, env), 'android')} once)`)
    }
  }
  return status
}

/**
 * The command that opens `target` in its IDE: `open` on macOS, Android
 * Studio's `studio` or `studio.sh` launcher on Linux, else nothing.
 * @param {'ios' | 'android'} platform
 * @param {string} target
 * @param {Record<string, string | undefined>} env
 * @param {NodeJS.Platform} os
 * @returns {[string, string[]] | undefined}
 */
export function ideCommand(platform, target, env, os) {
  if (os === 'darwin') return platform === 'ios' ? ['open', [target]] : ['open', ['-a', 'Android Studio', target]]
  if (os !== 'linux' || platform === 'ios') return undefined
  const studio = findOnPath(['studio', 'studio.sh'], env.PATH)
  return studio ? [studio, [target]] : undefined
}

/**
 * The first of `names` that's an executable file on `path`.
 * @param {string[]} names
 * @param {string | undefined} path
 */
function findOnPath(names, path = '') {
  for (const name of names) {
    for (const dir of path.split(delimiter).filter(Boolean)) {
      const file = join(dir, name)
      try {
        accessSync(file, constants.X_OK)
        if (statSync(file).isFile()) return file
      } catch {}
    }
  }
  return undefined
}
