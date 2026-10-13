import { describe, expect, test } from 'claude-code/testing'

import { emcc } from './fixtures/emcc'
import { probe } from './fixtures/probe'
import { call, command, endTurn, prompt, seen, session, state } from './fixtures/session'

const WITH_EMCC = { plugins: [emcc, probe] }
const WITH_PROBE = { plugins: [probe] }
const EDIT = { tool: 'Edit', file_path: '/repo/src/cart.js', old_string: 'round(x)\n', new_string: 'round(x * 100) / 100\nreturn y\nz\n' }

describe('the goal', () => {
  test('comes from the prompt; /goal replaces it and, empty, gives it back', WITH_PROBE, async ($, on) => {
    session(on)
    await prompt($, 'Fix the rounding in withTax. Then run the tests.')
    expect(await state($, 'goal')).toBe('Fix the rounding in withTax.')
    expect(await command($, 'goal', 'fix withTax; done when `npm test` passes')).toBe('Goal set with 1 criterion.')
    expect(await state($, 'goal')).toBe('fix withTax')
    expect(await state($, 'criteria')).toEqual([{ text: '`npm test` passes', command: 'npm test', isTicked: false }])
    await prompt($, 'Also update the README.')
    expect(await state($, 'goal')).toBe('fix withTax')
    expect(await command($, 'goal')).toBe('Goal cleared; it follows your prompt again.')
    expect(await state($, 'goal')).toBe('Also update the README.')
    expect(await state($, 'criteria')).toEqual([])
    expect(await state($, 'goalSetAt')).toBeNull()
  })

  test('criteria with no goal text keep the goal following the prompt', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix the cart.')
    await it.clock.advance(3000)
    expect(await command($, 'goal', 'done when `npm test` passes')).toBe('1 criterion set; the goal follows your prompt.')
    expect(await state($, 'goal')).toBe('Fix the cart.')
    expect(await state($, 'isGoalSet')).toBe(false)
    expect(await state($, 'goalSetAt')).toBe(3000)
    await prompt($, 'Now the README.')
    expect(await state($, 'goal')).toBe('Now the README.')
    expect(await state($, 'criteria')).toEqual([{ text: '`npm test` passes', command: 'npm test', isTicked: false }])
  })

  test('a slash command is not a goal', WITH_PROBE, async ($, on) => {
    session(on)
    await prompt($, 'Fix the cart.')
    await prompt($, '/compact')
    expect(await state($, 'goal')).toBe('Fix the cart.')
  })

  test('a criterion counts only the flags raised after /goal set it', WITH_EMCC, async ($, on) => {
    const it = session(on)
    it.isWide = false
    await prompt($, 'Fix the cart.')
    await it.clock.advance(1000)
    await command($, 'emcc-flag', 'an old lowered bar')
    await it.clock.advance(1000)
    await command($, 'goal', 'fix withTax; done when `npm test` passes')
    await call($, it, { tool: 'Bash', command: 'npm test' })
    expect(await command($, 'live')).toBe('Goal: fix withTax\n1/1 proven')
    await command($, 'emcc-flag', 'changes the values in 1 assertion')
    await call($, it, { tool: 'Bash', command: 'npm test' })
    expect(await command($, 'live')).toBe('Goal: fix withTax\n0/1 proven')
  })
})

describe('the ribbon', () => {
  test('each call adds its phase for the time since the last one, and the turn end starts waiting', WITH_EMCC, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    await call($, it, { tool: 'Read', file_path: '/repo/src/cart.js' }, 2000)
    await call($, it, EDIT, 3000)
    it.failing.add('npm test')
    await call($, it, { tool: 'Bash', command: 'npm test' }, 1000)
    await call($, it, EDIT, 4000)
    it.failing.delete('npm test')
    await call($, it, { tool: 'Bash', command: 'npm test' }, 1000)
    await call($, it, { tool: 'TaskList' }, 500)
    await endTurn($)
    await it.clock.advance(5000)
    await prompt($, 'thanks')
    const shown = ((await state($, 'segments')) as { phase: string; start: number; end: number }[]).map(one => [one.phase, one.end - one.start])
    expect(shown).toEqual([
      ['explore', 2000],
      ['implement', 3000],
      ['verify', 1000],
      ['debug', 4000],
      ['verify', 1500],
      ['waiting', 5000],
    ])
    expect(await state($, 'totals')).toEqual({ explore: 2000, implement: 3000, verify: 2500, debug: 4000, waiting: 5000 })
  })
})

describe('steps, edits and runs', () => {
  test('Claude’s tasks become steps, and edits belong to the step in progress', WITH_EMCC, async ($, on) => {
    const it = session(on)
    await call($, it, { tool: 'TaskCreate', subject: 'Fix withTax', description: 'x' })
    await call($, it, { tool: 'TaskCreate', subject: 'Update README', description: 'x' })
    await call($, it, { ...EDIT, file_path: '/repo/notes.md' })
    await call($, it, { tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
    await call($, it, EDIT)
    await call($, it, { tool: 'TaskUpdate', taskId: '1', status: 'completed', subject: 'Fix withTax rounding' })
    await call($, it, { tool: 'TaskUpdate', taskId: '2', status: 'deleted' })
    const steps = (await state($, 'steps')) as { id: string; subject: string; status: string; startedAt: number; completedAt: number }[]
    expect(steps.map(one => [one.id, one.subject, one.status])).toEqual([['1', 'Fix withTax rounding', 'completed']])
    expect(steps[0]?.startedAt).toBe(4000)
    expect(steps[0]?.completedAt).toBe(6000)
    expect(((await state($, 'edits')) as { file: string; stepId: string | null }[]).map(one => [one.file, one.stepId])).toEqual([
      ['/repo/notes.md', null],
      ['/repo/src/cart.js', '1'],
    ])
  })

  test('a refused or failed edit is not an edit; every shell command is a run', WITH_EMCC, async ($, on) => {
    const it = session(on)
    it.failing.add('/repo/a.js')
    await call($, it, { tool: 'Write', file_path: '/repo/a.js', content: 'x' })
    // The engine beneath fails the command as typed; witness records it collapsed.
    it.failing.add('npm  test')
    await call($, it, { tool: 'Bash', command: 'npm  test' })
    // A key witness never wrote reads as null: nothing recorded either way.
    expect((await state($, 'edits')) ?? []).toEqual([])
    expect(await state($, 'runs')).toEqual([{ command: 'npm test', at: 2000, isOk: false }])
  })

  test('Now names the action while it runs and clears after', WITH_EMCC, async ($, on) => {
    const it = session(on)
    await call($, it, { tool: 'Peek' })
    expect(await seen($)).toEqual([{ label: 'uses Peek', since: 1000 }])
    expect(await state($, 'now')).toBeNull()
  })
})

describe('opening and pausing', () => {
  test('the pane opens itself on the first tool call, once', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    expect(it.opened).toEqual([{ id: 'witness', title: 'witness', closeOnEscape: true }])
    expect(await state($, 'isPlaced')).toBe(true)
  })

  test('/live opens it focused, and answers in text when it cannot be placed', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix the cart.')
    it.isWide = false
    expect(await command($, 'live')).toBe('Goal: Fix the cart.\n0/0 proven')
    expect(it.opened.at(-1)).toEqual({ id: 'witness', title: 'witness', focus: true, closeOnEscape: true })
    it.isWide = true
    expect(await command($, 'live')).toBe('witness opened.')
  })

  test('paused, witness records nothing until /live resume', WITH_EMCC, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    expect(await command($, 'live', 'pause')).toBe('witness paused for this session.')
    expect(await state($, 'isPaused')).toBe(true)
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    await endTurn($)
    expect((await state($, 'segments')) ?? []).toEqual([])
    expect(await state($, 'waitingSince')).toBeNull()
    await it.clock.advance(3000)
    expect(await command($, 'live', 'resume')).toBe('witness is watching again.')
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    // The time spent paused belongs to no phase: the ribbon picks up at the resume.
    expect(await state($, 'segments')).toEqual([{ phase: 'explore', start: 4000, end: 5000 }])
  })

  test('a hook that fails leaves the tool call’s result as it was', WITH_PROBE, async ($, on) => {
    const it = session(on)
    it.isCwdBroken = true
    const out = await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    expect(out).toEqual({ result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' })
    expect(await state($, 'lostAt')).toBe('tool.call')
  })
})
