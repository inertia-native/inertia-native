// Minimal line-based prompts on node:readline (no dependencies).
import { createInterface } from 'node:readline/promises'

/**
 * @typedef {object} Prompter
 * @property {(label: string, fallback: string, check?: (value: string) => string | undefined) => Promise<string>} text
 *   Asks for a value; empty input takes `fallback`; `check` returns an error to re-ask.
 * @property {(label: string, choices: string[], fallback: string) => Promise<string>} select
 *   Asks to pick one of `choices` by number or by name.
 * @property {(label: string) => Promise<boolean>} confirm
 *   Asks a yes/no question; empty input means yes.
 * @property {() => void} close
 */

/**
 * The terminal is taken over at the first question only, so a prompter that
 * asks nothing leaves stdin alone.
 * @param {NodeJS.ReadableStream} input
 * @param {NodeJS.WritableStream} output
 * @returns {Prompter}
 */
export function createPrompter(input, output) {
  /** @type {import('node:readline/promises').Interface | undefined} */
  let rl
  const ask = (/** @type {string} */ query) => (rl ??= createInterface({ input, output })).question(query)
  const write = (/** @type {string} */ s) => output.write(s)

  return {
    async text(label, fallback, check) {
      for (;;) {
        const answer = (await ask(`? ${label} (${fallback}) › `)).trim() || fallback
        const error = check?.(answer)
        if (!error) return answer
        write(`  ${error}\n`)
      }
    },
    async select(label, choices, fallback) {
      // Paths, names with spaces and long lists read better numbered.
      const numbered = choices.length > 3 || choices.some((choice) => /[\s/]/.test(choice) || choice.length > 20)
      if (numbered) choices.forEach((choice, i) => write(`  ${i + 1}) ${choice}\n`))
      const hint = numbered ? `1-${choices.length}` : choices.join('/')
      for (;;) {
        const answer = (await ask(`? ${label} [${hint}] (${fallback}) › `)).trim()
        if (!answer) return fallback
        const byNumber = choices[Number(answer) - 1]
        if (/^\d+$/.test(answer) && byNumber) return byNumber
        if (choices.includes(answer)) return answer
        write(`  Pick one of: ${numbered ? hint : choices.join(', ')}\n`)
      }
    },
    async confirm(label) {
      for (;;) {
        const answer = (await ask(`? ${label} (Y/n) › `)).trim().toLowerCase()
        if (answer === '' || answer === 'y' || answer === 'yes') return true
        if (answer === 'n' || answer === 'no') return false
        write('  Answer y or n\n')
      }
    },
    close() {
      rl?.close()
      rl = undefined
    },
  }
}
