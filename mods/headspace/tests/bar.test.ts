import { describe, expect, test } from 'claude-code/testing'

import type { HeadspaceKind, HeadspaceSegment } from '../types'
import { COLOURS, ORDER, fallback, formatTokens, toSegments, widths, type Category } from '../hooks/bar'

// The categories a real session's breakdown carried in the spike (fact 7), with round figures.
const BREAKDOWN: Category[] = [
  { name: 'System prompt', tokens: 3000, kind: 'used' },
  { name: 'System tools', tokens: 12000, kind: 'used' },
  { name: 'MCP server instructions', tokens: 1500, kind: 'used' },
  { name: 'MCP tools (deferred)', tokens: 40000, kind: 'deferred' },
  { name: 'System tools (deferred)', tokens: 9000, kind: 'deferred' },
  { name: 'Memory files', tokens: 4000, kind: 'used' },
  { name: 'Skills', tokens: 2500, kind: 'used' },
  { name: 'Messages', tokens: 20000, kind: 'used' },
  { name: 'Free space', tokens: 124000, kind: 'free' },
  { name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' },
]

const tokensOf = (segments: HeadspaceSegment[], kind: HeadspaceKind) => segments.find(s => s.kind === kind)?.tokens
const seg = (kind: HeadspaceKind, tokens: number): HeadspaceSegment => ({ kind, tokens })
const widthOf = (cells: { kind: HeadspaceKind; width: number }[], kind: HeadspaceKind) => cells.find(c => c.kind === kind)?.width
const sum = (cells: { width: number }[]) => cells.reduce((total, c) => total + c.width, 0)

describe('toSegments', () => {
  test('the breakdown categories map to the six kinds, deferred left out', async () => {
    const segments = toSegments(BREAKDOWN, 0, 0)
    expect(segments.map(s => s.kind)).toEqual(ORDER)
    // System prompt, System tools, MCP server instructions and Skills; no deferred row.
    expect(tokensOf(segments, 'system')).toBe(3000 + 12000 + 1500 + 2500)
    expect(tokensOf(segments, 'rules')).toBe(4000)
    expect(tokensOf(segments, 'conversation')).toBe(20000)
    expect(tokensOf(segments, 'large')).toBe(0)
    expect(tokensOf(segments, 'free')).toBe(124000)
    expect(tokensOf(segments, 'reserve')).toBe(33000)
  })

  test('MCP server instructions alone counts as system', async () => {
    const segments = toSegments([{ name: 'MCP server instructions', tokens: 700, kind: 'used' }], 0, 0)
    expect(tokensOf(segments, 'system')).toBe(700)
  })

  test('session rule tokens add to the rules', async () => {
    expect(tokensOf(toSegments(BREAKDOWN, 0, 120), 'rules')).toBe(4120)
  })

  test('a large share of 0.5 moves half of Messages to large', async () => {
    const segments = toSegments(BREAKDOWN, 0.5, 0)
    expect(tokensOf(segments, 'large')).toBe(10000)
    expect(tokensOf(segments, 'conversation')).toBe(10000)
  })

  test('a large share above 1 is clamped: large never exceeds Messages', async () => {
    const segments = toSegments(BREAKDOWN, 1.7, 0)
    expect(tokensOf(segments, 'large')).toBe(20000)
    expect(tokensOf(segments, 'conversation')).toBe(0)
  })

  test('a negative large share moves nothing', async () => {
    const segments = toSegments(BREAKDOWN, -0.3, 0)
    expect(tokensOf(segments, 'large')).toBe(0)
    expect(tokensOf(segments, 'conversation')).toBe(20000)
  })
})

describe('widths', () => {
  test('a full window fills every column exactly', async () => {
    const segments = toSegments(BREAKDOWN, 0.25, 0)
    const window = segments.reduce((total, s) => total + s.tokens, 0)
    for (const columns of [10, 37, 60, 100, 143]) {
      const cells = widths(segments, window, columns)
      expect(sum(cells)).toBe(columns)
      expect(cells.map(c => c.kind)).toEqual(ORDER)
    }
  })

  test('widths are proportional to tokens', async () => {
    const cells = widths([seg('system', 25), seg('conversation', 25), seg('free', 50)], 100, 20)
    expect(widthOf(cells, 'system')).toBe(5)
    expect(widthOf(cells, 'conversation')).toBe(5)
    expect(widthOf(cells, 'free')).toBe(10)
  })

  test('a window that is not full draws fewer cells than columns', async () => {
    const cells = widths([seg('system', 30), seg('conversation', 40)], 100, 20)
    expect(sum(cells)).toBe(14)
    // Just short of full still leaves the last cell empty.
    expect(sum(widths([seg('system', 50), seg('free', 49)], 100, 10))).toBe(9)
  })

  test('floating point does not lose a cell the tokens cover', async () => {
    // 29 / 100 * 100 is 28.999999999999996 in floating point.
    expect(sum(widths([seg('system', 29)], 100, 100))).toBe(29)
  })

  test('a 1-token segment still gets one cell', async () => {
    const cells = widths([seg('system', 100000), seg('rules', 1), seg('free', 99999)], 200000, 50)
    expect(widthOf(cells, 'rules')).toBe(1)
    expect(sum(cells)).toBe(50)
  })

  test('the one-cell minimum never pushes the bar past its columns', async () => {
    const cells = widths([seg('system', 1), seg('rules', 1), seg('conversation', 1), seg('free', 7)], 10, 4)
    expect(sum(cells)).toBe(4)
    expect(widthOf(cells, 'system')).toBe(1)
    expect(widthOf(cells, 'rules')).toBe(1)
    expect(widthOf(cells, 'conversation')).toBe(1)
    expect(widthOf(cells, 'free')).toBe(1)
  })

  test('a sliver raised to one cell takes no spare cell', async () => {
    // 0.9, 1.3, 7.8: system already holds one cell, so the spare goes to free (0.8), then rules would.
    const cells = widths([seg('system', 9), seg('rules', 13), seg('free', 78)], 100, 10)
    expect(widthOf(cells, 'system')).toBe(1)
    expect(widthOf(cells, 'rules')).toBe(1)
    expect(widthOf(cells, 'free')).toBe(8)
  })

  test('cells the minimum took come back one donor at a time', async () => {
    // Three slivers take three cells; conversation (3.7) and free (6.0) give back two, one each.
    const cells = widths([seg('system', 1), seg('rules', 1), seg('conversation', 37), seg('large', 1), seg('free', 60)], 100, 10)
    expect(sum(cells)).toBe(10)
    expect(widthOf(cells, 'conversation')).toBe(2)
    expect(widthOf(cells, 'free')).toBe(5)
  })

  test('more non-empty segments than columns: the earlier kinds keep their cell', async () => {
    const cells = widths(ORDER.map(kind => seg(kind, 1)), 6, 3)
    expect(cells.map(c => c.width)).toEqual([1, 1, 1, 0, 0, 0])
  })

  test('an empty segment gets no cell', async () => {
    const cells = widths([seg('system', 50), seg('large', 0), seg('free', 50)], 100, 10)
    expect(widthOf(cells, 'large')).toBe(0)
  })

  test('a tie in remainders goes to the earlier kind', async () => {
    // 1.5 cells each: the spare cell goes to system, earlier in ORDER, whatever the input order.
    const segments = [seg('rules', 3), seg('system', 3), seg('free', 4)]
    const cells = widths(segments, 10, 5)
    expect(widthOf(cells, 'system')).toBe(2)
    expect(widthOf(cells, 'rules')).toBe(1)
    expect(widthOf(cells, 'free')).toBe(2)
  })

  test('the largest remainder wins the spare cell', async () => {
    // 1.2, 1.7, 2.1: the spare cell goes to rules (0.7), not to the earlier system (0.2).
    const cells = widths([seg('system', 12), seg('rules', 17), seg('free', 21)], 50, 5)
    expect(widthOf(cells, 'system')).toBe(1)
    expect(widthOf(cells, 'rules')).toBe(2)
    expect(widthOf(cells, 'free')).toBe(2)
  })

  test('no window draws nothing', async () => {
    expect(sum(widths([seg('system', 10)], 0, 20))).toBe(0)
    expect(sum(widths([seg('system', 10)], 100, 0))).toBe(0)
    expect(widths([seg('system', 10)], 100, -3).map(c => c.width)).toEqual([0])
  })

  test('a count that is not a number draws nothing and the rest still adds up', async () => {
    const cells = widths([seg('system', Number.NaN), seg('rules', Number.POSITIVE_INFINITY), seg('free', 50)], 100, 10)
    expect(widthOf(cells, 'system')).toBe(0)
    expect(widthOf(cells, 'rules')).toBe(0)
    expect(widthOf(cells, 'free')).toBe(5)
  })
})

describe('fallback', () => {
  test('labels from 100 columns, counts from 70, the percentage alone below', async () => {
    expect(fallback(100)).toBe('full')
    expect(fallback(99)).toBe('counts')
    expect(fallback(70)).toBe('counts')
    expect(fallback(69)).toBe('bare')
  })
})

describe('formatTokens', () => {
  test('short counts as the bar shows them', async () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(9200)).toBe('9.2k')
    expect(formatTokens(148000)).toBe('148k')
    expect(formatTokens(1200000)).toBe('1.2M')
  })

  test('round figures drop the decimal and edges carry to the next unit', async () => {
    expect(formatTokens(10000)).toBe('10k')
    expect(formatTokens(16400)).toBe('16.4k')
    expect(formatTokens(148400)).toBe('148k')
    expect(formatTokens(999.6)).toBe('1k')
    expect(formatTokens(999600)).toBe('1M')
  })
})

describe('COLOURS', () => {
  test('every kind has its colour', async () => {
    expect(ORDER.map(kind => COLOURS[kind])).toEqual(['#b0aea5', '#d97757', '#6a9bcc', '#788c5d', '#b0aea5', '#b0aea5'])
  })
})
