// Terminal prompts on @clack/prompts: arrow keys to pick, Enter takes the
// default, Ctrl+C or Esc cancels.
import { confirm, isCancel, select, text } from '@clack/prompts'

/**
 * @typedef {object} Prompter
 * @property {(label: string, fallback: string, check?: (value: string) => string | undefined) => Promise<string>} text
 *   Asks for a value; empty input takes `fallback`; `check` returns an error to re-ask.
 * @property {(label: string, choices: string[], fallback: string) => Promise<string>} select
 *   Asks to pick one of `choices`, starting on `fallback`.
 * @property {(label: string, fallback?: boolean) => Promise<boolean>} confirm
 *   Asks a yes/no question, starting on `fallback` (yes by default).
 * @property {() => void} close
 */

/** Thrown when the user cancels a prompt. */
export class Cancelled extends Error {
  constructor() {
    super('Cancelled.')
  }
}

/**
 * Each prompt takes the terminal over only while it's shown, so a prompter
 * that asks nothing leaves stdin alone.
 * @param {NodeJS.ReadableStream} input
 * @param {NodeJS.WritableStream} output
 * @returns {Prompter}
 */
export function createPrompter(input, output) {
  const streams = /** @type {import('@clack/prompts').CommonOptions} */ ({ input, output })
  /** @template T @param {T} value @returns {Exclude<T, symbol>} */
  const answer = (value) => {
    if (isCancel(value)) throw new Cancelled()
    return /** @type {Exclude<T, symbol>} */ (value)
  }

  return {
    async text(label, fallback, check) {
      const validate = (/** @type {string | undefined} */ value) => check?.(value || fallback)
      return answer(await text({ ...streams, message: label, placeholder: fallback, defaultValue: fallback, validate }))
    },
    async select(label, choices, fallback) {
      return answer(await select({ ...streams, message: label, options: choices.map((value) => ({ value })), initialValue: fallback }))
    },
    async confirm(label, fallback = true) {
      return answer(await confirm({ ...streams, message: label, initialValue: fallback }))
    },
    close() {},
  }
}
