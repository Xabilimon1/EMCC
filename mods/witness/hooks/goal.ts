import type { WitnessCriterion } from '../types'

const DONE_WHEN = /\b(?:done when|hecho cuando)\b/i
const SENTENCE_END = /[.!?](?=\s|$)|\n/
const LONGEST = 100

export type ParsedGoal = { goal: string; criteria: WitnessCriterion[] }

export function collapsed(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

export function sameCommand(a: string, b: string): boolean {
  return collapsed(a) === collapsed(b)
}

/** The first sentence of a prompt, at most 100 characters. */
export function goalFromPrompt(text: string): string {
  const trimmed = text.trim()
  const end = SENTENCE_END.exec(trimmed)
  const first = end === null ? trimmed : trimmed.slice(0, end[0] === '\n' ? end.index : end.index + 1).trim()

  return first.length > LONGEST ? `${first.slice(0, LONGEST - 1)}…` : first
}

/** `/goal` text: the goal, then criteria after "done when", split by `;`. */
export function parseGoal(text: string): ParsedGoal {
  const trimmed = text.trim()
  const match = DONE_WHEN.exec(trimmed)
  if (match === null) {
    return { goal: trimmed, criteria: [] }
  }
  const goal = trimmed.slice(0, match.index).replace(/[\s;,]+$/, '')
  const criteria = trimmed
    .slice(match.index + match[0].length)
    .split(';')
    .map(part => part.trim())
    .filter(part => part !== '')
    .map(part => {
      const inTicks = /`([^`]+)`/.exec(part)?.[1]

      return { text: part, command: inTicks === undefined ? null : collapsed(inTicks), isTicked: false }
    })

  return { goal, criteria }
}
