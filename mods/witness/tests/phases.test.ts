import { describe, expect, test } from 'claude-code/testing'

import { KEEP_SEGMENTS, addedTotal, appended, durationText, phaseOf, ribbonOf } from '../hooks/phases'

const tool = (name: string, extra: { command?: string; isCheck?: boolean; isError?: boolean } = {}) => ({
  tool: name,
  command: extra.command,
  isCheck: extra.isCheck ?? false,
  isError: extra.isError ?? false,
})

describe('phaseOf', () => {
  test('reading explores, editing implements', async () => {
    expect(phaseOf(tool('Read'), false)).toEqual({ phase: 'explore', isDebugging: false })
    expect(phaseOf(tool('Edit'), false)).toEqual({ phase: 'implement', isDebugging: false })
    expect(phaseOf(tool('Write'), false).phase).toBe('implement')
    expect(phaseOf(tool('NotebookEdit'), false).phase).toBe('implement')
  })

  test('read-only shell commands explore', async () => {
    for (const command of ['rg withTax src', 'ls -la', 'git log --oneline -5', 'git diff', 'cat src/cart.js', 'find . -name "*.js"']) {
      expect(phaseOf(tool('Bash', { command }), false).phase).toBe('explore')
    }
  })

  test('searching with Grep explores', async () => {
    expect(phaseOf(tool('Grep'), false)).toEqual({ phase: 'explore', isDebugging: false })
  })

  test('a leading cd does not hide a read-only command', async () => {
    for (const command of ['cd /repo && git status', 'cd /repo && cd src && ls', 'cd "/my repo" && rg withTax']) {
      expect(phaseOf(tool('Bash', { command }), false).phase).toBe('explore')
    }
    expect(phaseOf(tool('Bash', { command: 'cd /repo && npm install' }), false).phase).toBeNull()
    expect(phaseOf(tool('Bash', { command: 'npm install && ls' }), false).phase).toBeNull()
  })

  test('a check verifies; a failed one starts debugging, a passing one ends it', async () => {
    expect(phaseOf(tool('Bash', { command: 'npm test', isCheck: true, isError: true }), false)).toEqual({ phase: 'verify', isDebugging: true })
    expect(phaseOf(tool('Edit'), true)).toEqual({ phase: 'debug', isDebugging: true })
    expect(phaseOf(tool('Bash', { command: 'npm test', isCheck: true }), true)).toEqual({ phase: 'verify', isDebugging: false })
  })

  test('anything else has no phase of its own', async () => {
    expect(phaseOf(tool('TaskCreate'), false)).toEqual({ phase: null, isDebugging: false })
    expect(phaseOf(tool('Bash', { command: 'npm install' }), true)).toEqual({ phase: null, isDebugging: true })
  })
})

describe('appended', () => {
  test('a new phase starts a segment, the same phase extends the last one', async () => {
    const one = appended([], 'explore', 0, 1000)
    const two = appended(one, 'explore', 1000, 3000)
    const three = appended(two, 'implement', 3000, 4000)
    expect(three).toEqual([
      { phase: 'explore', start: 0, end: 3000 },
      { phase: 'implement', start: 3000, end: 4000 },
    ])
  })

  test(`more than ${KEEP_SEGMENTS} segments merge the oldest two`, async () => {
    let list = appended([], 'explore', 0, 1)
    for (let index = 1; index <= KEEP_SEGMENTS; index += 1) {
      list = appended(list, index % 2 === 0 ? 'explore' : 'implement', index, index + 1)
    }
    expect(list.length).toBe(KEEP_SEGMENTS)
    expect(list[0]).toEqual({ phase: 'explore', start: 0, end: 2 })
  })
})

describe('ribbonOf', () => {
  test('splits the width by time, rounding so the cells add up to the width', async () => {
    const cells = ribbonOf(
      [
        { phase: 'explore', start: 0, end: 1000 },
        { phase: 'implement', start: 1000, end: 4000 },
        { phase: 'verify', start: 4000, end: 5000 },
      ],
      10,
    )
    expect(cells).toEqual([
      { phase: 'explore', chars: 2 },
      { phase: 'implement', chars: 6 },
      { phase: 'verify', chars: 2 },
    ])
    expect(cells.reduce((sum, cell) => sum + cell.chars, 0)).toBe(10)
  })

  test('a boundary falls on the nearest character, not the one below', async () => {
    const thirds = ribbonOf(
      [
        { phase: 'explore', start: 0, end: 1000 },
        { phase: 'implement', start: 1000, end: 2000 },
        { phase: 'verify', start: 2000, end: 3000 },
      ],
      10,
    )
    expect(thirds).toEqual([
      { phase: 'explore', chars: 3 },
      { phase: 'implement', chars: 4 },
      { phase: 'verify', chars: 3 },
    ])
  })

  test('nothing yet draws nothing', async () => {
    expect(ribbonOf([], 10)).toEqual([])
  })
})

describe('totals and durations', () => {
  test('adds each phase up', async () => {
    let totals = {}
    totals = addedTotal(totals, 'explore', 1000)
    totals = addedTotal(totals, 'implement', 1000)
    totals = addedTotal(totals, 'explore', 2000)
    expect(totals).toEqual({ explore: 3000, implement: 1000 })
  })

  test('survive the cap on segments: 400 alternating seconds still add up to 200s each', async () => {
    let segments: ReturnType<typeof appended> = []
    let totals = {}
    for (let index = 0; index < 400; index += 1) {
      const phase = index % 2 === 0 ? 'explore' : 'implement'
      segments = appended(segments, phase, index * 1000, (index + 1) * 1000)
      totals = addedTotal(totals, phase, 1000)
    }
    expect(segments.length).toBe(KEEP_SEGMENTS)
    expect(totals).toEqual({ explore: 200_000, implement: 200_000 })
  })

  test('reads as seconds under a minute, minutes after', async () => {
    expect(durationText(400)).toBe('0s')
    expect(durationText(42_000)).toBe('42s')
    expect(durationText(59_999)).toBe('59s')
    expect(durationText(60_000)).toBe('1m')
    expect(durationText(192_000)).toBe('3m')
  })
})
