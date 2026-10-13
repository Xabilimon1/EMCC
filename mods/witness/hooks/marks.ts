import type { WitnessCriterion, WitnessEdit, WitnessRun, WitnessStep } from '../types'
import { sameCommand } from './goal'

/** A check from emcc-core's evidence log (an `edit` entry is not one). */
export type Check = { kind: string; at: number; command?: string; isOk?: boolean }

/** A flag from emcc-core. */
export type Flag = { source: string; rule: string; text: string; file?: string; at: number }

export type Mark =
  | { kind: 'proven'; by: string; at: number }
  | { kind: 'unproven' }
  | { kind: 'stale'; editsAfter: number }
  | { kind: 'flagged'; text: string }
  | { kind: 'pending'; isActive: boolean }
  | { kind: 'unknown' }

export type CriterionMark =
  | { kind: 'proven'; at: number }
  | { kind: 'failing'; at: number }
  | { kind: 'stale'; editsAfter: number }
  | { kind: 'open' }
  | { kind: 'ticked' }

const PROVING = new Set(['test', 'build', 'typecheck'])

/**
 * A step's mark, computed from what happened, never stored. `checks` and
 * `flags` are null when emcc-core could not be asked.
 */
export function markOf(
  step: WitnessStep,
  edits: readonly WitnessEdit[],
  checks: readonly Check[] | null,
  flags: readonly Flag[] | null,
): Mark {
  const begin = step.startedAt ?? step.createdAt
  const end = step.completedAt ?? Number.POSITIVE_INFINITY
  const flag = (flags ?? []).filter(one => one.at >= begin && one.at <= end).at(-1)
  if (flag !== undefined) {
    return { kind: 'flagged', text: flag.text }
  }
  if (step.status !== 'completed') {
    return { kind: 'pending', isActive: step.status === 'in_progress' }
  }
  if (checks === null) {
    return { kind: 'unknown' }
  }
  const proof = checks.filter(check => PROVING.has(check.kind) && check.isOk === true && check.at >= begin).at(-1)
  if (proof === undefined) {
    return { kind: 'unproven' }
  }
  const files = new Set(edits.filter(one => step.id !== null && one.stepId === step.id).map(one => one.file))
  const editsAfter = edits.filter(one => one.at > proof.at && (files.size === 0 || files.has(one.file))).length

  return editsAfter === 0 ? { kind: 'proven', by: proof.command ?? proof.kind, at: proof.at } : { kind: 'stale', editsAfter }
}

/** A `/goal` criterion's mark: its command's newest run, against every edit after it. */
export function criterionMarkOf(
  criterion: WitnessCriterion,
  runs: readonly WitnessRun[],
  edits: readonly WitnessEdit[],
): CriterionMark {
  if (criterion.command === null) {
    return criterion.isTicked ? { kind: 'ticked' } : { kind: 'open' }
  }
  const command = criterion.command
  const run = runs.filter(one => sameCommand(one.command, command)).at(-1)
  if (run === undefined) {
    return { kind: 'open' }
  }
  if (!run.isOk) {
    return { kind: 'failing', at: run.at }
  }
  const editsAfter = edits.filter(one => one.at > run.at).length

  return editsAfter === 0 ? { kind: 'proven', at: run.at } : { kind: 'stale', editsAfter }
}
