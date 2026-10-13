import type { Plugin } from 'claude-code/testing'

/**
 * A mod that reads witness's state the way another plugin would, because a
 * test's own hooks may not call `$.state.get` (the host refuses any module
 * whose scanned source does not spell the call, and the test engine has no
 * `$.state`). `witness-state` answers every value as one JSON object; a tool
 * called `Peek` records what witness holds as `now` while it runs, and
 * `witness-seen` answers those records as a JSON array. Every read is written
 * out with literal `plugin` and `key`, as the scan requires.
 */
export const probe: Plugin = {
  name: 'witness-probe',
  tier: 'user',
  register(on) {
    const seen: unknown[] = []

    on('command.run', { command: 'witness-state' }, async $ => {
      const all = {
        goal: (await $.state.get({ plugin: 'witness', key: 'goal' })).value,
        promptGoal: (await $.state.get({ plugin: 'witness', key: 'promptGoal' })).value,
        isGoalSet: (await $.state.get({ plugin: 'witness', key: 'isGoalSet' })).value,
        criteria: (await $.state.get({ plugin: 'witness', key: 'criteria' })).value,
        steps: (await $.state.get({ plugin: 'witness', key: 'steps' })).value,
        edits: (await $.state.get({ plugin: 'witness', key: 'edits' })).value,
        runs: (await $.state.get({ plugin: 'witness', key: 'runs' })).value,
        segments: (await $.state.get({ plugin: 'witness', key: 'segments' })).value,
        cursor: (await $.state.get({ plugin: 'witness', key: 'cursor' })).value,
        waitingSince: (await $.state.get({ plugin: 'witness', key: 'waitingSince' })).value,
        isDebugging: (await $.state.get({ plugin: 'witness', key: 'isDebugging' })).value,
        now: (await $.state.get({ plugin: 'witness', key: 'now' })).value,
        beat: (await $.state.get({ plugin: 'witness', key: 'beat' })).value,
        hasOpened: (await $.state.get({ plugin: 'witness', key: 'hasOpened' })).value,
        isPlaced: (await $.state.get({ plugin: 'witness', key: 'isPlaced' })).value,
        isPaused: (await $.state.get({ plugin: 'witness', key: 'isPaused' })).value,
        lostAt: (await $.state.get({ plugin: 'witness', key: 'lostAt' })).value,
      }

      return { text: JSON.stringify(all) }
    })
    on('command.run', { command: 'witness-seen' }, async () => ({ text: JSON.stringify(seen) }))
    on('tool.call', async ($, e, next) => {
      if ((e as unknown as { tool: string }).tool === 'Peek') {
        seen.push((await $.state.get({ plugin: 'witness', key: 'now' })).value ?? null)
      }

      return next(e)
    })
  },
}
