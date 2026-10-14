/**
 * The pure half of headspace-cut: reading the instructions headspace sends
 * and rebuilding the conversation with the marked tool results stubbed.
 */

export const CUT_PREFIX = 'headspace-cut:'

/** What headspace sends: the results to stub, each with the label its stub names. */
export type CutRequest = { marks: { id: string; label: string }[] }

/** One tool_result block as `session.compact` hands it, and as a rebuilt message carries it. */
type ResultBlock = { tool_use_id: string; text: string; isError: boolean }

/** Reads `instructions`; null when they are not a headspace-cut request or do not parse. */
export function parseCut(instructions: string | undefined): CutRequest | null {
  if (instructions === undefined) {
    return null
  }
  const text = instructions.trim()
  if (!text.startsWith(CUT_PREFIX)) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(CUT_PREFIX.length))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const marks = (parsed as { marks?: unknown }).marks
  if (!Array.isArray(marks)) {
    return null
  }
  const out: CutRequest['marks'] = []
  for (const mark of marks as unknown[]) {
    if (typeof mark !== 'object' || mark === null) {
      return null
    }
    const { id, label } = mark as { id?: unknown; label?: unknown }
    if (typeof id !== 'string' || typeof label !== 'string') {
      return null
    }
    out.push({ id, label })
  }

  return { marks: out }
}

/** The stub a removed result becomes. */
export function stubText(label: string): string {
  return `[headspace removed the result of ${label}; run it again if you need it]`
}

/**
 * Every message as it was (same object, handle kept) except user messages
 * holding a marked result: rebuilt without `handle` as { role, text, toolUses,
 * toolResults }, the marked results' text replaced by the stub, the others kept.
 * `missing` lists marked ids found in no message.
 */
export function cutMessages<M extends { role: string; text: string; toolUses: unknown[]; toolResults?: ResultBlock[]; handle?: string }>(
  messages: readonly M[],
  request: CutRequest,
): { messages: (M | Omit<M, 'handle'>)[]; missing: string[] } {
  const labels = new Map(request.marks.map(mark => [mark.id, mark.label]))
  const found = new Set<string>()
  const out = messages.map((message): M | Omit<M, 'handle'> => {
    const results = message.toolResults
    if (results === undefined || !results.some(one => labels.has(one.tool_use_id))) {
      return message
    }
    const toolResults = results.map(one => {
      const label = labels.get(one.tool_use_id)
      if (label === undefined) {
        return one
      }
      found.add(one.tool_use_id)

      return { tool_use_id: one.tool_use_id, text: stubText(label), isError: one.isError }
    })
    const { handle: _handle, ...rest } = message

    return { ...rest, toolResults }
  })

  return { messages: out, missing: request.marks.map(mark => mark.id).filter(id => !found.has(id)) }
}
