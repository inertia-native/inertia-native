// Command dispatch for the `inertia-native` bin.
import { spawn, spawnSync } from 'node:child_process'

import { init, INIT_USAGE } from './init.mjs'
import { open, OPEN_USAGE } from './open.mjs'
import { run, RUN_USAGE } from './run.mjs'

const USAGE = `Usage: npx inertia-native <command>

Commands:
  init [ios|android|both]   Set up inertia-native and create the native shells
  run <ios|android>         Build, install and launch the app in a simulator/emulator
  open <ios|android>        Open the native project in Xcode or Android Studio

Run \`npx inertia-native <command> --help\` for options.`

/**
 * @param {string[]} argv
 * @param {Partial<import('./init.mjs').IO>} [overrides]
 * @returns {Promise<number>}
 */
export async function main(argv, overrides = {}) {
  /** @type {import('./init.mjs').IO} */
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
    ...overrides,
  }
  const [command, ...rest] = argv
  if (command === 'init') return init(rest, io)
  if (command === 'run') return run(rest, io)
  if (command === 'open') return open(rest, io)
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    const out = command === undefined ? io.stderr : io.stdout
    out.write(`${USAGE}\n\n${INIT_USAGE}\n\n${RUN_USAGE}\n\n${OPEN_USAGE}\n`)
    return command === undefined ? 1 : 0
  }
  io.stderr.write(`Unknown command "${command}".\n\n${USAGE}\n`)
  return 1
}
