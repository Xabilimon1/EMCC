import { describe, expect, test } from 'claude-code/testing'

import type { WitnessEdit, WitnessStep } from '../types'
import { criterionMarkOf, markOf } from '../hooks/marks'

const step = (extra: Partial<WitnessStep> = {}): WitnessStep => ({
  id: '1',
  subject: 'Fix withTax',
  status: 'completed',
  createdAt: 0,
  startedAt: 100,
  completedAt: 900,
  ...extra,
})
const edit = (at: number, file = '/repo/src/cart.js', stepId: string | null = '1'): WitnessEdit => ({ file, at, stepId })
const pass = (at: number, command = 'npm test') => ({ kind: 'test', at, command, isOk: true })
const fail = (at: number) => ({ kind: 'test', at, command: 'npm test', isOk: false })

describe('markOf', () => {
  test('a check passing after the step’s edits proves it', async () => {
    expect(markOf(step(), [edit(200)], [fail(150), pass(300)], [])).toEqual({ kind: 'proven', by: 'npm test', at: 300 })
  })

  test('no passing check since the step began leaves it unproven; lint does not prove', async () => {
    expect(markOf(step(), [edit(200)], [fail(300)], [])).toEqual({ kind: 'unproven' })
    expect(markOf(step(), [edit(200)], [{ kind: 'lint', at: 300, isOk: true }], [])).toEqual({ kind: 'unproven' })
    expect(markOf(step(), [edit(200)], [pass(50)], [])).toEqual({ kind: 'unproven' })
  })

  test('edits to its files after the check make the proof stale', async () => {
    const edits = [edit(200), edit(400), edit(500, '/repo/src/cart.js', '2'), edit(600, '/repo/README.md', '2')]
    expect(markOf(step(), edits, [pass(300)], [])).toEqual({ kind: 'stale', editsAfter: 2 })
  })

  test('a step with no edits of its own is judged by any edit after its check', async () => {
    expect(markOf(step(), [edit(400, '/repo/x.js', '9')], [pass(300)], [])).toEqual({ kind: 'stale', editsAfter: 1 })
    expect(markOf(step(), [], [pass(300)], [])).toMatchObject({ kind: 'proven' })
  })

  test('a flag during the step marks it, even after a passing check', async () => {
    const flags = [{ source: 'goalpost-guard', rule: 'tests.expected', text: 'changes the values in 1 assertion (let through and reported)', at: 250 }]
    expect(markOf(step(), [edit(200)], [pass(300)], flags)).toEqual({ kind: 'flagged', text: 'changes the values in 1 assertion (let through and reported)' })
    expect(markOf(step(), [edit(200)], [pass(300)], [{ ...flags[0]!, at: 950 }])).toMatchObject({ kind: 'proven' })
    expect(markOf(step({ status: 'in_progress', completedAt: null }), [edit(200)], [], flags)).toMatchObject({ kind: 'flagged' })
  })

  test('steps not completed are pending, the one in progress active', async () => {
    expect(markOf(step({ status: 'pending', startedAt: null, completedAt: null }), [], [], [])).toEqual({ kind: 'pending', isActive: false })
    expect(markOf(step({ status: 'in_progress', completedAt: null }), [], [], [])).toEqual({ kind: 'pending', isActive: true })
  })

  test('without emcc-core a completed step is unknown, never proven', async () => {
    expect(markOf(step(), [edit(200)], null, null)).toEqual({ kind: 'unknown' })
  })

  test('a step that never went in progress began when it was created', async () => {
    expect(markOf(step({ startedAt: null, createdAt: 10 }), [], [pass(20)], [])).toMatchObject({ kind: 'proven' })
  })
})

describe('criterionMarkOf', () => {
  const runs = [
    { command: 'npm test', at: 100, isOk: false },
    { command: 'npm  test', at: 300, isOk: true },
  ]

  test('its command passing after the newest edit proves it; an edit after makes it stale', async () => {
    const criterion = { text: '`npm test` passes', command: 'npm test', isTicked: false }
    expect(criterionMarkOf(criterion, runs, [edit(200)])).toEqual({ kind: 'proven', at: 300 })
    expect(criterionMarkOf(criterion, runs, [edit(200), edit(400)])).toEqual({ kind: 'stale', editsAfter: 1 })
    expect(criterionMarkOf(criterion, runs.slice(0, 1), [])).toEqual({ kind: 'failing', at: 100 })
    expect(criterionMarkOf({ ...criterion, command: 'npm run build' }, runs, [])).toEqual({ kind: 'open' })
  })

  test('without a command it is ticked by hand', async () => {
    expect(criterionMarkOf({ text: 'README updated', command: null, isTicked: false }, runs, [])).toEqual({ kind: 'open' })
    expect(criterionMarkOf({ text: 'README updated', command: null, isTicked: true }, runs, [])).toEqual({ kind: 'ticked' })
  })
})
