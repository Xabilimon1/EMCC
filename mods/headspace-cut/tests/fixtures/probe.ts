import type { Plugin } from 'claude-code/testing'

/**
 * Reads headspace-cut's state the way headspace does, because a test's own
 * hooks may not call `$.state.get` (the host refuses a module whose scanned
 * source does not spell the call, and the test engine has no `$.state`).
 * `headspace-cut-state` answers `{ ready, seenAt }` as JSON (each null when never written).
 */
export const probe: Plugin = {
  name: 'headspace-cut-probe',
  tier: 'user',
  register(on) {
    on('command.run', { command: 'headspace-cut-state' }, async $ => {
      const ready = (await $.state.get({ plugin: 'headspace-cut', key: 'ready' })).value
      const seenAt = (await $.state.get({ plugin: 'headspace-cut', key: 'seenAt' })).value

      return { text: JSON.stringify({ ready: ready ?? null, seenAt: seenAt ?? null }) }
    })
  },
}
