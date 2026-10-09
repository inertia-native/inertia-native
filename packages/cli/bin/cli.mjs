// Command dispatch for the `inertia-native` bin.
import { spawn, spawnSync } from 'node:child_process'

import { init, INIT_USAGE } from './init.mjs'
import { open, OPEN_USAGE } from './open.mjs'
import { Cancelled } from './prompt.mjs'
import { run, RUN_USAGE } from './run.mjs'

const USAGE = `Usage: npx inertia-native <command>

Commands:
  init [ios|android|both]   Set up inertia-native and create the native shells
  run <ios|android>         Build, install and launch the app in a simulator/emulator
  open <ios|android>        Open the native project in Xcode or Android Studio

Run \`npx inertia-native <command> --help\` for options.`

/**
 * @param {string[]} argv
 * @param {Partial<import('./run.mjs').RunIO>} [overrides]
 * @returns {Promise<number>}
 */
export async function main(argv, overrides = {}) {
  /** @type {import('./run.mjs').RunIO} */
  const io = {
    cwd: process.cwd(),
    env: process.env,
    os: process.platform,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    exec: (cmd, args, { cwd, env, detached }) => {
      if (!detached) return spawnSync(cmd, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1
      spawn(cmd, args, { cwd, env, detached: true, stdio: 'ignore' }).on('error', () => {}).unref()
      return 0
    },
    capture: (cmd, args) => {
      const result = spawnSync(cmd, args, { encoding: 'utf8' })
      return { ok: result.status === 0, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? result.error?.message ?? '') }
    },
    spawn: (cmd, args, { cwd, env, background = false } = {}) =>
      new Promise((resolve) => {
        const child = background
          ? spawn(cmd, args, { detached: true, stdio: 'ignore' })
          : spawn(cmd, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' })
        child.on('error', () => resolve(127))
        child.on('exit', (code) => resolve(code ?? 1))
        if (background) child.unref()
      }),
    ...overrides,
  }
  const [command, ...rest] = argv
  const commands = { init, run, open }
  if (Object.hasOwn(commands, command)) {
    try {
      return await commands[/** @type {keyof typeof commands} */ (command)](rest, io)
    } catch (error) {
      if (!(error instanceof Cancelled)) throw error
      io.stderr.write('Cancelled. Nothing was changed.\n')
      return 130
    }
  }
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    const out = command === undefined ? io.stderr : io.stdout
    out.write(`${USAGE}\n\n${INIT_USAGE}\n\n${RUN_USAGE}\n\n${OPEN_USAGE}\n`)
    return command === undefined ? 1 : 0
  }
  io.stderr.write(`Unknown command "${command}".\n\n${USAGE}\n`)
  return 1
}
