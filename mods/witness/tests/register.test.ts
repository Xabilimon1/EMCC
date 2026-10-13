import { describe, expect, test } from 'claude-code/testing'

import { emcc } from './fixtures/emcc'
import { probe } from './fixtures/probe'
import { call, command, endTurn, hold, prompt, seen, session, state } from './fixtures/session'

const WITH_EMCC = { plugins: [emcc, probe] }
const WITH_PROBE = { plugins: [probe] }
const EDIT = { tool: 'Edit', file_path: '/repo/src/cart.js', old_string: 'round(x)\n', new_string: 'round(x * 100) / 100\nreturn y\nz\n' }

type Segment = { phase: string; start: number; end: number }
const lengths = (segments: Segment[]) => segments.map(one => [one.phase, one.start, one.end])

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

  test('only a person’s prompt is a goal', WITH_PROBE, async ($, on) => {
    session(on)
    await prompt($, 'Fix the cart.')
    await prompt($, 'Background task bg-1 finished.', { origin: { kind: 'task-notification' } })
    await prompt($, 'Another session says hi.', { origin: { kind: 'peer' } })
    expect(await state($, 'goal')).toBe('Fix the cart.')
    await prompt($, 'Fix the README.', { origin: { kind: 'bridge' } })
    expect(await state($, 'goal')).toBe('Fix the README.')
    await prompt($, 'Fix the build.', { origin: { kind: 'sdk' } })
    expect(await state($, 'goal')).toBe('Fix the build.')
    await prompt($, 'Fix the tests.', { origin: { kind: 'composer' } })
    expect(await state($, 'goal')).toBe('Fix the tests.')
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

  test('a check sent to the background proves nothing and moves no phase', WITH_EMCC, async ($, on) => {
    const it = session(on)
    it.isWide = false
    await prompt($, 'Fix the cart.')
    await command($, 'goal', 'fix withTax; done when `npm test` passes')
    await call($, it, { tool: 'Read', file_path: '/repo/src/cart.js' })
    await call($, it, { tool: 'Bash', command: 'npm test', run_in_background: true })
    expect((await state($, 'runs')) ?? []).toEqual([])
    expect(await command($, 'live')).toBe('Goal: fix withTax\n0/1 proven')
    expect(lengths(await state($, 'segments'))).toEqual([['explore', 0, 2000]])
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
    const shown = ((await state($, 'segments')) as Segment[]).map(one => [one.phase, one.end - one.start])
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

  test('a call with no phase continues the work, never the waiting', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    await endTurn($)
    await it.clock.advance(3000)
    await prompt($, 'Go on.')
    await call($, it, { tool: 'TaskCreate', subject: 'Fix', description: 'x' }, 2000)
    expect(lengths(await state($, 'segments'))).toEqual([
      ['explore', 0, 1000],
      ['waiting', 1000, 4000],
      ['explore', 4000, 6000],
    ])
  })

  test('the turn’s last stretch ends at the turn end, and work after waiting starts where waiting ends', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' }, 2000)
    await it.clock.advance(1000)
    await endTurn($)
    await it.clock.advance(4000)
    await hold($, it, EDIT, 1000)
    expect(lengths(await state($, 'segments'))).toEqual([
      ['explore', 0, 3000],
      ['waiting', 3000, 7000],
      ['implement', 7000, 8000],
    ])
    expect(await state($, 'totals')).toEqual({ explore: 3000, waiting: 4000, implement: 1000 })
  })

  test('a subagent’s turn end is not the person’s move', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' }, 2000)
    await endTurn($, 'agent-1')
    expect(await state($, 'waitingSince')).toBeNull()
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' }, 3000)
    expect(lengths(await state($, 'segments'))).toEqual([['explore', 0, 5000]])
    expect(await state($, 'totals')).toEqual({ explore: 5000 })
  })

  test('the main turn ending while a subagent’s call runs keeps Now', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    const running = $.tool.call({ tool: 'Grep', pattern: 'withTax', holdMs: 1000 } as never)
    await it.clock.settle()
    await endTurn($)
    expect(await state($, 'now')).toEqual({ label: 'uses Grep', since: 0 })
    await it.clock.advance(1000)
    await running
    expect(await state($, 'now')).toBeNull()
  })

  test('a prompt delivered into a running turn moves nothing', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' }, 2000)
    await it.clock.advance(1000)
    await prompt($, 'Also the README.', { turnId: 'turn-1' })
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    expect(await state($, 'totals')).toEqual({ explore: 4000 })
  })

  test('a slash command leaves the waiting open', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    await endTurn($)
    await it.clock.advance(2000)
    await prompt($, '/compact')
    // The command's own turn ending keeps the waiting where it began.
    await endTurn($)
    expect(await state($, 'waitingSince')).toBe(1000)
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    expect(lengths(await state($, 'segments'))).toEqual([
      ['explore', 0, 1000],
      ['waiting', 1000, 4000],
    ])
  })

  test('calls in parallel count their time once, and Now clears after the last', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    const first = $.tool.call({ tool: 'Read', file_path: '/repo/a.js', holdMs: 1000 } as never)
    const second = $.tool.call({ tool: 'Read', file_path: '/repo/b.js', holdMs: 500 } as never)
    const third = $.tool.call({ tool: 'Grep', pattern: 'withTax', holdMs: 1000 } as never)
    await it.clock.settle()
    expect(await state($, 'now')).toEqual({ label: 'uses Grep', since: 0 })
    await it.clock.advance(500)
    await second
    expect(await state($, 'now')).toEqual({ label: 'uses Grep', since: 0 })
    await it.clock.advance(500)
    await Promise.all([first, third])
    expect(await state($, 'now')).toBeNull()
    expect(lengths(await state($, 'segments'))).toEqual([['explore', 0, 1000]])
    expect(await state($, 'totals')).toEqual({ explore: 1000 })
  })

  test('a call recorded late, behind a slow answer, keeps its own stretch', WITH_EMCC, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    // The check ends at 500 and the read at 1000, but emcc-core says what the check was only at 1500.
    const check = $.tool.call({ tool: 'Bash', command: 'npm test --slow', holdMs: 500 } as never)
    const reading = $.tool.call({ tool: 'Read', file_path: '/repo/a.js', holdMs: 1000 } as never)
    await it.clock.settle()
    await it.clock.advance(1000)
    await it.clock.advance(500)
    await command($, 'emcc-answer')
    await Promise.all([check, reading])
    expect(lengths(await state($, 'segments'))).toEqual([
      ['verify', 0, 500],
      ['explore', 500, 1000],
    ])
    expect(await state($, 'totals')).toEqual({ verify: 500, explore: 500 })
  })

  test('a denied call took its time, and changes nothing else', WITH_EMCC, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    it.denying.add('Edit').add('Bash').add('TaskCreate')
    await call($, it, EDIT, 2000)
    await call($, it, { tool: 'Bash', command: 'npm test' })
    await call($, it, { tool: 'TaskCreate', subject: 'Fix', description: 'x' })
    expect(lengths(await state($, 'segments'))).toEqual([['implement', 0, 4000]])
    expect((await state($, 'edits')) ?? []).toEqual([])
    expect((await state($, 'runs')) ?? []).toEqual([])
    expect((await state($, 'steps')) ?? []).toEqual([])
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
    await call($, it, EDIT)
    await call($, it, { tool: 'TaskUpdate', taskId: '1', status: 'completed', subject: 'Fix withTax rounding' })
    await call($, it, { tool: 'TaskUpdate', taskId: '2', status: 'deleted' })
    const steps = (await state($, 'steps')) as { id: string; subject: string; status: string; startedAt: number; completedAt: number; files: string[] }[]
    expect(steps.map(one => [one.id, one.subject, one.status])).toEqual([['1', 'Fix withTax rounding', 'completed']])
    expect(steps[0]?.startedAt).toBe(4000)
    expect(steps[0]?.completedAt).toBe(7000)
    expect(steps[0]?.files).toEqual(['/repo/src/cart.js'])
    expect(((await state($, 'edits')) as { file: string; stepId: string | null }[]).map(one => [one.file, one.stepId])).toEqual([
      ['/repo/notes.md', null],
      ['/repo/src/cart.js', '1'],
      ['/repo/src/cart.js', '1'],
    ])
  })

  test('an edit belongs to the step that went in progress last', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await call($, it, { tool: 'TaskCreate', subject: 'Fix withTax', description: 'x' })
    await call($, it, { tool: 'TaskCreate', subject: 'Update README', description: 'x' })
    await call($, it, { tool: 'TaskUpdate', taskId: '2', status: 'in_progress' })
    await call($, it, { tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
    await call($, it, EDIT)
    expect(((await state($, 'edits')) as { stepId: string | null }[]).map(one => one.stepId)).toEqual(['1'])
    expect(((await state($, 'steps')) as { id: string; files: string[] }[]).map(one => [one.id, one.files])).toEqual([
      ['1', ['/repo/src/cart.js']],
      ['2', []],
    ])
  })

  test('a task’s id comes from the structured result, or from the text when that is all there is', WITH_PROBE, async ($, on) => {
    const it = session(on)
    it.taskAnswer = 'text'
    await call($, it, { tool: 'TaskCreate', subject: 'From the text', description: 'x' })
    it.taskAnswer = 'structured'
    await call($, it, { tool: 'TaskCreate', subject: 'From the result', description: 'x' })
    expect(((await state($, 'steps')) as { id: string | null }[]).map(one => one.id)).toEqual(['1', '2'])
  })

  test('a step reopened is in progress again, its first start kept', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await call($, it, { tool: 'TaskCreate', subject: 'Fix withTax', description: 'x' })
    await call($, it, { tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
    await call($, it, { tool: 'TaskUpdate', taskId: '1', status: 'completed' })
    await call($, it, { tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
    const steps = (await state($, 'steps')) as { status: string; startedAt: number; completedAt: number | null }[]
    expect(steps.map(one => [one.status, one.startedAt, one.completedAt])).toEqual([['in_progress', 2000, null]])
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

describe('the badge', () => {
  test('changes only after a call that can change a mark, and only when its text does', WITH_EMCC, async ($, on) => {
    const it = session(on)
    it.isWide = false
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    expect(JSON.parse(await command($, 'emcc-badges'))).toEqual([])
    await call($, it, EDIT)
    await call($, it, EDIT)
    await call($, it, { tool: 'TaskCreate', subject: 'Fix withTax', description: 'x' })
    expect(JSON.parse(await command($, 'emcc-badges'))).toEqual([
      { id: 'witness', text: 'witness 0/0 proven, /live', tone: 'neutral' },
      { id: 'witness', text: 'witness 0/1 proven, /live', tone: 'neutral' },
    ])
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
    await prompt($, 'Something else.')
    expect((await state($, 'segments')) ?? []).toEqual([])
    expect(await state($, 'waitingSince')).toBeNull()
    expect(await state($, 'goal')).toBe('Fix it.')
    await it.clock.advance(3000)
    expect(await command($, 'live', 'resume')).toBe('witness is watching again.')
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    // The time spent paused belongs to no phase: the ribbon picks up at the resume.
    expect(await state($, 'segments')).toEqual([{ phase: 'explore', start: 4000, end: 5000 }])
  })

  test('a call that ends after the pause is not recorded', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    const running = $.tool.call({ tool: 'Read', file_path: '/repo/a.js', holdMs: 1000 } as never)
    await it.clock.settle()
    await command($, 'live', 'pause')
    await it.clock.advance(1000)
    await running
    expect((await state($, 'segments')) ?? []).toEqual([])
    expect(await state($, 'now')).toBeNull()
  })

  test('pausing while it is the person’s move keeps the waiting so far', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    await endTurn($)
    await it.clock.advance(2000)
    await command($, 'live', 'pause')
    expect(lengths(await state($, 'segments'))).toEqual([
      ['explore', 0, 1000],
      ['waiting', 1000, 3000],
    ])
    expect(await state($, 'waitingSince')).toBeNull()
    expect(await state($, 'totals')).toEqual({ explore: 1000, waiting: 2000 })
  })

  test('a hook that fails before the call leaves the call’s result as it was', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await command($, 'witness-break', 'hasOpened')
    const out = await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    expect(out).toEqual({ result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' })
    expect(await state($, 'lostAt')).toBe('tool.call')
  })

  test('a hook that fails after the call leaves the call’s result as it was', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    await command($, 'witness-break', 'runs')
    const out = await call($, it, { tool: 'Bash', command: 'ls' })
    expect(out).toEqual({ result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' })
    expect(await state($, 'lostAt')).toBe('tool.call')
    expect(lengths(await state($, 'segments'))).toEqual([['explore', 0, 1000]])
  })

  test('a call that throws keeps its time, clears Now, and throws on as it was', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    await expect(call($, it, { tool: 'Crash' })).rejects.toThrow()
    expect(await state($, 'now')).toBeNull()
    expect(lengths(await state($, 'segments'))).toEqual([['explore', 0, 2000]])
  })

  test('without a working directory the call is still watched, and the waiting closes once', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    await endTurn($)
    it.isCwdBroken = true
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' }, 2000)
    await hold($, it, { tool: 'Read', file_path: '/repo/a.js' }, 1000)
    expect(lengths(await state($, 'segments'))).toEqual([
      ['explore', 0, 1000],
      ['waiting', 1000, 3000],
      ['explore', 3000, 4000],
    ])
    expect(await state($, 'lostAt')).toBeNull()
  })

  test('a command that fails answers so, and records where', WITH_PROBE, async ($, on) => {
    session(on)
    await command($, 'witness-break', 'criteria')
    expect(await command($, 'goal', 'fix withTax; done when `npm test` passes')).toBe('witness lost track at /goal.')
    expect(await state($, 'lostAt')).toBe('command.run')
    await command($, 'witness-break', 'isPaused')
    expect(await command($, 'live', 'pause')).toBe('witness lost track at /live.')
  })
})
