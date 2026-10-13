import type { WitnessPhase, WitnessSegment } from '../types'

export const KEEP_SEGMENTS = 200

const EXPLORE_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const READ_ONLY = /^\s*(?:rg|grep|ls|cat|head|tail|find|fd|tree|wc|git\s+(?:log|diff|show|status|blame))\b/

/** What witness knows of a finished tool call. `isCheck` comes from emcc-core's `kindsOf`. */
export type ToolFacts = { tool: string; command?: string; isCheck: boolean; isError: boolean }

export type PhaseStep = { phase: WitnessPhase | null; isDebugging: boolean }

/**
 * The phase a finished tool call belongs to, and whether Claude is debugging
 * after it: a failed check starts debugging, a passing one ends it. `null`
 * counts toward the phase in progress.
 */
export function phaseOf(facts: ToolFacts, isDebugging: boolean): PhaseStep {
  if (EDIT_TOOLS.has(facts.tool)) {
    return { phase: isDebugging ? 'debug' : 'implement', isDebugging }
  }
  if (EXPLORE_TOOLS.has(facts.tool)) {
    return { phase: 'explore', isDebugging }
  }
  if (facts.tool === 'Bash') {
    if (facts.isCheck) {
      return { phase: 'verify', isDebugging: facts.isError }
    }
    if (READ_ONLY.test(facts.command ?? '')) {
      return { phase: 'explore', isDebugging }
    }
  }

  return { phase: null, isDebugging }
}

/** The segments with this stretch added: the same phase extends the last one; past the cap the oldest two merge. */
export function appended(segments: readonly WitnessSegment[], phase: WitnessPhase, start: number, end: number): WitnessSegment[] {
  const last = segments.at(-1)
  let next =
    last !== undefined && last.phase === phase
      ? [...segments.slice(0, -1), { ...last, end: Math.max(last.end, end) }]
      : [...segments, { phase, start, end }]
  while (next.length > KEEP_SEGMENTS) {
    const [first, second, ...rest] = next
    if (first === undefined || second === undefined) {
      break
    }
    next = [{ phase: first.phase, start: first.start, end: second.end }, ...rest]
  }

  return next
}

export type Cell = { phase: WitnessPhase; chars: number }

/** The ribbon `width` characters wide, each phase's share by time. */
export function ribbonOf(segments: readonly WitnessSegment[], width: number): Cell[] {
  const total = segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0)
  if (total <= 0 || width <= 0) {
    return []
  }
  const cells: Cell[] = []
  let elapsed = 0
  let used = 0
  for (const segment of segments) {
    elapsed += segment.end - segment.start
    const boundary = Math.round((elapsed / total) * width)
    const chars = boundary - used
    used = boundary
    if (chars <= 0) {
      continue
    }
    const last = cells.at(-1)
    if (last !== undefined && last.phase === segment.phase) {
      last.chars += chars
    } else {
      cells.push({ phase: segment.phase, chars })
    }
  }

  return cells
}

export function totalsOf(segments: readonly WitnessSegment[]): Partial<Record<WitnessPhase, number>> {
  const totals: Partial<Record<WitnessPhase, number>> = {}
  for (const segment of segments) {
    totals[segment.phase] = (totals[segment.phase] ?? 0) + (segment.end - segment.start)
  }

  return totals
}

export function durationText(ms: number): string {
  const seconds = Math.floor(ms / 1000)

  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`
}
