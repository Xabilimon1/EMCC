import type { Plugin } from 'claude-code/testing'

/**
 * A mod that reads headspace's state the way another plugin would, because a
 * test's own hooks may not call `$.state.get` (the host refuses any module
 * whose scanned source does not spell the call, and the test engine has no
 * `$.state`). `headspace-state` answers every value as one JSON object.
 *
 * `headspace-seed <key> <json>` makes headspace read `<json>` for `key` until
 * headspace writes that key itself: how a test sets up rule changes, session
 * rules or marks without the pane's buttons (Task 8 presses those). A seed
 * that is not the contract's shape is how a test makes a hook throw.
 *
 * `headspace-cut-ready on|off` says whether headspace-cut is installed, as
 * its `ready` value would (never written, as without the plugin, by default).
 * Every read is written out with literal `plugin` and `key`, as the scan requires.
 */
export const probe: Plugin = {
  name: 'headspace-probe',
  tier: 'user',
  register(on) {
    const seeds = new Map<string, unknown>()
    let ready: boolean | undefined

    on('command.run', { command: 'headspace-state' }, async $ => {
      const all = {
        snapshot: (await $.state.get({ plugin: 'headspace', key: 'snapshot' })).value,
        pending: (await $.state.get({ plugin: 'headspace', key: 'pending' })).value,
        applied: (await $.state.get({ plugin: 'headspace', key: 'applied' })).value,
        sessionRules: (await $.state.get({ plugin: 'headspace', key: 'sessionRules' })).value,
        pendingSessionRules: (await $.state.get({ plugin: 'headspace', key: 'pendingSessionRules' })).value,
        marks: (await $.state.get({ plugin: 'headspace', key: 'marks' })).value,
        staleCount: (await $.state.get({ plugin: 'headspace', key: 'staleCount' })).value,
        selected: (await $.state.get({ plugin: 'headspace', key: 'selected' })).value,
        cursor: (await $.state.get({ plugin: 'headspace', key: 'cursor' })).value,
        isCutting: (await $.state.get({ plugin: 'headspace', key: 'isCutting' })).value,
        lostAt: (await $.state.get({ plugin: 'headspace', key: 'lostAt' })).value,
      }

      return { text: JSON.stringify(all) }
    })
    on('command.run', { command: 'headspace-seed' }, async (_$, e) => {
      const space = e.args.indexOf(' ')
      seeds.set(e.args.slice(0, space), JSON.parse(e.args.slice(space + 1)))

      return { text: 'seeded' }
    })
    on('command.run', { command: 'headspace-cut-ready' }, async (_$, e) => {
      ready = e.args.trim() === 'on' ? true : e.args.trim() === 'off' ? false : undefined

      return { text: String(ready) }
    })

    on('state.get', { plugin: 'headspace-cut', key: 'ready' }, async (_$, e, next) =>
      ready === undefined ? next(e) : ({ value: { value: ready, version: 1 } } as never),
    )
    for (const key of ['pending', 'applied', 'sessionRules', 'pendingSessionRules', 'marks', 'isCutting']) {
      on('state.get', { plugin: 'headspace', key } as never, async (_$, e, next) =>
        seeds.has(key) ? ({ value: { value: seeds.get(key), version: 1 } } as never) : next(e),
      )
      on('state.set', { plugin: 'headspace', key } as never, async (_$, e, next) => {
        seeds.delete(key)

        return next(e)
      })
    }
  },
}
