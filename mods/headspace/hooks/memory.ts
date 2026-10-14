/**
 * Auto-memory rides in the system prompt section `memory`: the engine's
 * instructions on how to use memory, then the index, one line per entry
 * (`- [Title](file.md) — hook`). These functions find the entries and render
 * the section without the ones turned off, leaving everything else alone.
 */

/** An auto-memory index entry: a line `- [Title](file.md) ...` in the memory section. */
export type MemoryEntry = { id: string; title: string; line: string }

/** A top-level list item that opens with a link: `- [title](target)`, both non-empty. */
const ENTRY = /^- \[([^\]]+)\]\(([^)\s]+)\)/

/** A code fence opener or closer: what sits inside is an example, never an entry. */
const FENCE = /^\s*(```|~~~)/

/** FNV-1a, 32 bits, as eight hex digits: a stable id with no engine call. */
const hash = (text: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Each raw line (split on `\n`, so a CRLF line keeps its `\r`) with its entry, if it is one. */
const scan = (sectionText: string): { raw: string; entry: MemoryEntry | null }[] => {
  let isInFence = false
  return sectionText.split('\n').map((raw) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (FENCE.test(line)) {
      isInFence = !isInFence
      return { raw, entry: null }
    }
    const match = isInFence ? null : ENTRY.exec(line)
    const title = match?.[1]
    if (title === undefined) return { raw, entry: null }
    return { raw, entry: { id: `memory#${hash(line)}`, title, line } }
  })
}

/**
 * The entries of the section text, in order; id = `memory#${hash(line)}`.
 * An identical line repeated is one entry: it has one id, and turning it off
 * removes every copy.
 */
export function memoryEntries(sectionText: string): MemoryEntry[] {
  const seen = new Set<string>()
  const entries: MemoryEntry[] = []
  for (const { entry } of scan(sectionText)) {
    if (entry === null || seen.has(entry.id)) continue
    seen.add(entry.id)
    entries.push(entry)
  }
  return entries
}

/** The section text with the entries whose id is in `off` removed; everything else byte for byte. */
export function renderMemory(sectionText: string, off: ReadonlySet<string>): string {
  if (off.size === 0) return sectionText
  return scan(sectionText)
    .filter(({ entry }) => entry === null || !off.has(entry.id))
    .map(({ raw }) => raw)
    .join('\n')
}
