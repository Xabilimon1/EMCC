import type { Register } from 'claude-code'

import { CUT_PREFIX, cutMessages, parseCut } from './cut'

/**
 * headspace-cut answers the compactions headspace starts (trigger `plugin`)
 * or the person types (`/compact headspace-cut:{...}`, trigger `manual`): the
 * marked tool results become one line each, every other message stays as the
 * engine has it, and nothing is summarized. Anything else passes beneath.
 *
 * It never falls through to `next` once a request is recognised: that would
 * summarize a conversation nobody asked to summarize. When it cannot answer,
 * it skips, and the conversation stays as it is.
 */
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.state.set({ plugin: 'headspace-cut', key: 'ready' }, true)
    } catch {
      // headspace then reads it as not installed and does not offer to remove results.
    }

    return next(e)
  })

  on('session.compact', async (_$, e, next) => {
    const isOurs = (e.trigger === 'plugin' || e.trigger === 'manual') && (e.instructions ?? '').trim().startsWith(CUT_PREFIX)
    if (!isOurs) {
      return next(e)
    }
    const request = parseCut(e.instructions)
    if (request === null) {
      return { skip: `headspace-cut: the instructions after ${CUT_PREFIX} do not parse` }
    }
    try {
      const { messages, missing } = cutMessages(e.messages, request)
      if (missing.length > 0) {
        const count = missing.length === 1 ? '1 marked result is' : `${missing.length} marked results are`

        return { skip: `headspace-cut: ${count} no longer in the conversation` }
      }

      return { messages }
    } catch (error) {
      return { skip: `headspace-cut: could not read the conversation (${error instanceof Error ? error.message : String(error)})` }
    }
  })
}
