import type { Plugin } from 'claude-code/testing'

/**
 * A mod that calls `$.emcc` the way another EMCC mod would and answers what it
 * got as JSON text, so a test reads the noun through a real caller.
 */
export const probe: Plugin = {
  name: 'probe',
  tier: 'user',
  register(on) {
    on('command.run', { command: 'probe-latest' }, async ($, e) => ({
      text: JSON.stringify(await $.emcc.evidenceLatest({ kind: e.args as 'test' })),
    }))
    on('command.run', { command: 'probe-since' }, async ($, e) => ({
      text: JSON.stringify(await $.emcc.evidenceSince({ at: Number(e.args) })),
    }))
    on('command.run', { command: 'probe-badge' }, async ($, e) => {
      const [id = '', text, tone] = e.args.split(' ')
      await $.emcc.badge({ id, text, tone: tone as 'good' | undefined })

      return { text: 'done' }
    })
    on('command.run', { command: 'probe-profile' }, async $ => ({ text: await $.emcc.profile() }))
    on('command.run', { command: 'probe-halted' }, async $ => ({ text: String(await $.emcc.isHalted()) }))
    on('command.run', { command: 'probe-flag' }, async ($, e) => {
      const [rule = '', ...words] = e.args.split(' ')
      await $.emcc.flag({ source: 'probe', rule, text: words.join(' ') })

      return { text: 'done' }
    })
    on('command.run', { command: 'probe-flags-since' }, async ($, e) => ({
      text: JSON.stringify(await $.emcc.flagsSince({ at: Number(e.args) })),
    }))
    on('command.run', { command: 'probe-kinds' }, async ($, e) => ({
      text: JSON.stringify(await $.emcc.kindsOf({ command: e.args })),
    }))
  },
}
