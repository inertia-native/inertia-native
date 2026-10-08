// Command dispatch for the `inertia-native` bin.
import { spawnSync } from 'node:child_process'

import { init, INIT_USAGE } from './init.mjs'
import { run, RUN_USAGE } from './run.mjs'

const USAGE = `Usage: npx inertia-native <command>

Commands:
  init [ios|android|both]   Set up inertia-native and create the native shells
  run <ios|android>         Build, install and launch the app in a simulator/emulator

Run \`npx inertia-native <command> --help\` for options.`

/**
 * @param {string[]} argv
 * @param {import('./init.mjs').IO} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, io = {}) {
  io = {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    exec: (cmd, args, { cwd, env }) =>
      spawnSync(cmd, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1,
    ...io,
  }
  const [command, ...rest] = argv
  if (command === 'init') return init(rest, io)
  if (command === 'run') return run(rest, io)
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    const out = command === undefined ? io.stderr : io.stdout
    out?.write(`${USAGE}\n\n${INIT_USAGE}\n\n${RUN_USAGE}\n`)
    return command === undefined ? 1 : 0
  }
  io.stderr?.write(`Unknown command "${command}".\n\n${USAGE}\n`)
  return 1
}
