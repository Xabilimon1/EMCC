import type { Plugin } from 'claude-code/testing'

/**
 * A stand-in for emcc-core 0.2.0. A test can't import the real module from
 * outside this plugin's folder, and a fixture runs on its own, so the test
 * drives it with commands: `emcc-check pass|fail <command>` records a test
 * run now, `emcc-flag <text>` raises a flag now, `emcc-badges` answers the
 * badges as JSON. `kindsOf` reports `npm test` and `tsc` as checks (as
 * `['test']`, enough for witness, which only asks whether a command is one),
 * and for a command with `--slow` answers only after `emcc-answer`.
 */
export const emcc: Plugin = {
  name: 'emcc-core',
  tier: 'user',
  register(on) {
    const evidence: { kind: string; at: number; command?: string; exitCode?: number; isOk?: boolean; file?: string }[] = []
    const flags: { source: string; rule: string; text: string; file?: string; at: number }[] = []
    const badges: unknown[] = []
    let answer = () => {}
    const answered = new Promise<void>(resolve => {
      answer = resolve
    })

    on('engine.create', async (_$, e, next) => {
      const beneath = await next(e)
      const added = {
        emcc: {
          profile: async () => 'standard' as const,
          isHalted: async () => false,
          badge: async (input: unknown) => {
            badges.push(input)
          },
          evidenceLatest: async () => null,
          evidenceSince: async ({ at }: { at: number }) => evidence.filter(item => item.at >= at),
          flag: async () => {},
          flagsSince: async ({ at }: { at: number }) => flags.filter(item => item.at >= at),
          kindsOf: async ({ command }: { command: string }) => {
            // A command with `--slow` is answered only once the test says `emcc-answer`, as a busy host would.
            if (command.includes('--slow')) {
              await answered
            }

            return /\bnpm test\b|\btsc\b/.test(command) ? ['test'] : []
          },
        },
      }

      return { ...added, ...beneath }
    })
    on('command.run', { command: 'emcc-check' }, async ($, e) => {
      const [outcome = 'pass', ...words] = e.args.split(' ')
      const isOk = outcome === 'pass'
      evidence.push({ kind: 'test', at: await $.clock.now(), command: words.join(' '), exitCode: isOk ? 0 : 1, isOk })

      return { text: 'recorded' }
    })
    on('command.run', { command: 'emcc-flag' }, async ($, e) => {
      flags.push({ source: 'goalpost-guard', rule: 'tests.expected', text: e.args, at: await $.clock.now() })

      return { text: 'flagged' }
    })
    on('command.run', { command: 'emcc-answer' }, async () => {
      answer()

      return { text: 'answered' }
    })
    on('command.run', { command: 'emcc-badges' }, async () => ({ text: JSON.stringify(badges) }))
  },
}
