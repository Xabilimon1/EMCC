import type { Plugin } from 'claude-code/testing'

/**
 * A stand-in for emcc-core that keeps its contract: `$.emcc.profile()` and
 * `$.emcc.badge()`. A test can't import the real module from outside this
 * plugin's folder, and a fixture runs on its own (it sees none of the test's
 * variables), so the test drives it with commands: `emcc-profile <profile>`
 * sets what `profile()` answers, `emcc-badges` answers the badges as JSON,
 * `emcc-flags` answers the flags as JSON.
 */
export const emcc: Plugin = {
  name: 'emcc-core',
  tier: 'user',
  register(on) {
    let profile: 'standard' | 'strict' | 'off' = 'standard'
    const badges: unknown[] = []
    const flags: unknown[] = []

    on('engine.create', async (_$, e, next) => {
      const beneath = await next(e)
      const added = {
        emcc: {
          profile: async () => profile,
          isHalted: async () => profile === 'off',
          badge: async (input: unknown) => {
            badges.push(input)
          },
          evidenceLatest: async () => null,
          evidenceSince: async () => [],
          flag: async (input: unknown) => {
            flags.push(input)
          },
          flagsSince: async () => flags,
          kindsOf: async () => [],
        },
      }

      return { ...added, ...beneath }
    })
    on('command.run', { command: 'emcc-profile' }, async (_$, e) => {
      profile = e.args as typeof profile

      return { text: profile }
    })
    on('command.run', { command: 'emcc-badges' }, async () => ({ text: JSON.stringify(badges) }))
    on('command.run', { command: 'emcc-flags' }, async () => ({ text: JSON.stringify(flags) }))
  },
}
