import type { HeadspaceKind, HeadspaceSegment } from '../types'

export const COLOURS: Record<HeadspaceKind, string> = {
  system: '#b0aea5', rules: '#d97757', conversation: '#6a9bcc', large: '#788c5d', free: '#b0aea5', reserve: '#b0aea5',
}
export const ORDER: HeadspaceKind[] = ['system', 'rules', 'conversation', 'large', 'free', 'reserve']

/** A breakdown category as the engine gives it. */
export type Category = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }

const MEMORY_FILES = 'Memory files'
const MESSAGES = 'Messages'

/**
 * The six kinds from the breakdown. Deferred categories are left out. `Memory files` -> rules
 * (plus `sessionRuleTokens`); `Messages` -> conversation minus large; `Free space` -> free;
 * kind `buffer` -> reserve; every other used category -> system. `largeShare` is the
 * fraction (0..1) of Messages that large results take (from large.ts); large never exceeds Messages.
 */
export function toSegments(categories: Category[], largeShare: number, sessionRuleTokens: number): HeadspaceSegment[] {
  const tokens: Record<HeadspaceKind, number> = { system: 0, rules: sessionRuleTokens, conversation: 0, large: 0, free: 0, reserve: 0 }
  let messages = 0

  for (const category of categories) {
    if (category.kind === 'deferred') continue
    if (category.kind === 'free') tokens.free += category.tokens
    else if (category.kind === 'buffer') tokens.reserve += category.tokens
    else if (category.name === MEMORY_FILES) tokens.rules += category.tokens
    else if (category.name === MESSAGES) messages += category.tokens
    else tokens.system += category.tokens
  }

  const share = Number.isFinite(largeShare) ? Math.min(1, Math.max(0, largeShare)) : 0
  tokens.large = Math.round(messages * share)
  tokens.conversation = messages - tokens.large

  return ORDER.map(kind => ({ kind, tokens: tokens[kind] }))
}

/** One drawn cell run per segment. */
export type Cell = { kind: HeadspaceKind; width: number }

// A count that is not a positive finite number draws nothing.
const counted = (tokens: number) => (Number.isFinite(tokens) && tokens > 0 ? tokens : 0)

type Share = { kind: HeadspaceKind; rank: number; width: number; remainder: number; floor: number }

/**
 * Widths for `columns` cells, proportional to tokens over `window`; every segment with
 * tokens > 0 gets at least 1 cell; the sum is exactly `columns` when tokens fill the window,
 * never more. Largest-remainder rounding, ties to the earlier kind in ORDER.
 */
export function widths(segments: HeadspaceSegment[], window: number, columns: number): Cell[] {
  const isDrawn = window > 0
  const shares: Share[] = segments
    .map(s => {
      const ideal = isDrawn ? (counted(s.tokens) / window) * columns : 0
      const whole = Math.floor(ideal)
      // A non-empty segment keeps one cell even when its share is a sliver.
      const floor = ideal > 0 ? 1 : 0
      // Never wider than the bar, so every loop below ends.
      const width = Math.min(Math.max(0, columns), Math.max(whole, floor))
      // Measured from the cells given: a sliver raised to one cell has nothing left to claim.
      return { kind: s.kind, rank: ORDER.indexOf(s.kind), width, remainder: ideal - width, floor }
    })
    .sort((a, b) => a.rank - b.rank)

  const used = segments.reduce((total, s) => total + counted(s.tokens), 0)
  // Whole cells the tokens cover; a window not quite full leaves its last cell empty.
  const covered = isDrawn ? Math.floor(Math.min(1, used / window) * columns + 1e-9) : 0
  const minimum = shares.reduce((total, s) => total + s.floor, 0)
  const total = Math.min(columns, Math.max(covered, minimum))

  let drawn = shares.reduce((total, s) => total + s.width, 0)

  // Spare cells go to the largest remainders, ties to the earlier kind.
  const byRemainder = [...shares].sort((a, b) => b.remainder - a.remainder || a.rank - b.rank)
  for (const share of byRemainder) {
    if (drawn >= total) break
    share.width += 1
    drawn += 1
  }

  // Cells the one-cell minimum took are given back by the smallest remainders, ties from the later kind.
  while (drawn > total) {
    const donor = [...shares]
      .filter(s => s.width > s.floor)
      .sort((a, b) => a.remainder - b.remainder || b.rank - a.rank)[0]
    // More non-empty segments than columns: the later kinds lose their cell.
    const victim = donor ?? [...shares].filter(s => s.width > 0).sort((a, b) => b.rank - a.rank)[0]
    if (!victim) break
    victim.width -= 1
    victim.remainder += 1
    drawn -= 1
  }

  return shares.map(s => ({ kind: s.kind, width: s.width }))
}

/** How much text fits beside the bar: 'full' (labels and counts), 'counts' (no labels), 'bare' (percentage only). */
export function fallback(bodyColumns: number): 'full' | 'counts' | 'bare' {
  if (bodyColumns >= 100) return 'full'
  if (bodyColumns >= 70) return 'counts'
  return 'bare'
}

// One decimal below 100 of a unit, none from there; `10.0` drops its `.0`.
function scaled(value: number, unit: string): string {
  const text = value < 100 ? value.toFixed(1) : Math.round(value).toString()
  return text.replace(/\.0$/, '') + unit
}

/** `9.2k`, `148k`, `950`, `1.2M`. */
export function formatTokens(n: number): string {
  const tokens = Number.isFinite(n) ? Math.max(0, n) : 0
  if (Math.round(tokens) < 1000) return Math.round(tokens).toString()
  if (Math.round(tokens / 1000) < 1000) return scaled(tokens / 1000, 'k')
  return scaled(tokens / 1_000_000, 'M')
}
