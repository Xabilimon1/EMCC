import type { HeadspaceRuleChange } from '../types'

/**
 * One rule: its heading (the nearest `#` line above, '' at the top), position
 * under it, and lines. `start` is the index of its first line in the file,
 * `end` the index just past its last (as `slice` takes them).
 */
export type Rule = { id: string; heading: string; index: number; lines: string[]; start: number; end: number }

/** A parsed file: every line, and the rules found in it. Lines outside rules (headings, blanks, fences) are kept as they are. */
export type ParsedFile = { lines: string[]; rules: Rule[]; eol: '\n' | '\r\n'; finalNewline: boolean }

/** FNV-1a, 32 bits, as 8 hex digits: short and stable across runs. */
export const hash = (text: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/
const TOP_ITEM = /^ ?(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/
const FENCE_OPEN = /^\s*(`{3,}|~{3,})/
const BLANK = /^\s*$/

/** A line as classified: without the carriage return a file with mixed line ends leaves on it. */
const bare = (line: string) => (line.endsWith('\r') ? line.slice(0, -1) : line)

const closesFence = (line: string, fence: string) => {
  const m = /^\s*(`{3,}|~{3,})\s*$/.exec(line)
  return !!m && m[1]![0] === fence[0] && m[1]!.length >= fence.length
}

/** Splits text into lines the way render joins them back. */
const splitLines = (text: string): Pick<ParsedFile, 'lines' | 'eol' | 'finalNewline'> => {
  if (text === '') return { lines: [], eol: '\n', finalNewline: false }
  const breaks = text.split('\n').length - 1
  const crlfs = text.split('\r\n').length - 1
  const eol = breaks > 0 && crlfs === breaks ? '\r\n' : '\n'
  const lines = text.split(eol)
  const finalNewline = text.endsWith(eol)
  if (finalNewline) lines.pop()
  return { lines, eol, finalNewline }
}

/**
 * Splits text into rules: under each heading, each top-level list item (`- `, `* `, `+ `, `1. `)
 * with its continuation lines (indented lines and nested items), or each paragraph (a run of
 * non-blank lines that is not a heading). A fenced code block (``` or ~~~) is never split: it belongs
 * whole to the rule it sits in, or is a rule of its own. Headings are not rules; neither are
 * frontmatter at the top nor a comment block (`<!-- ... -->`) standing on its own, which the engine
 * strips before the model reads the file.
 * `id` = `${heading}#${index}#${hash(lines.join('\n'))}`; a second rule with the very same id gets `#2`, `#3`, ... after it.
 */
export function parseRules(text: string): ParsedFile {
  const { lines, eol, finalNewline } = splitLines(text)
  const rules: Rule[] = []
  const seen = new Map<string, number>()

  let heading = ''
  let index = 0
  let cur: { start: number; end: number; kind: 'item' | 'paragraph' | 'fence' } | null = null
  let fence: string | null = null
  let afterBlank = false

  const close = () => {
    if (!cur) return
    const ruleLines = lines.slice(cur.start, cur.end).map(bare)
    const base = `${heading}#${index}#${hash(ruleLines.join('\n'))}`
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    rules.push({ id: count === 1 ? base : `${base}#${count}`, heading, index, lines: ruleLines, start: cur.start, end: cur.end })
    index++
    cur = null
  }

  let i = 0
  if (lines.length > 0 && bare(lines[0]!) === '---') {
    const endAt = lines.findIndex((l, j) => j > 0 && bare(l) === '---')
    if (endAt > 0) i = endAt + 1
  }

  for (; i < lines.length; i++) {
    const line = bare(lines[i]!)

    if (fence !== null) {
      cur!.end = i + 1
      if (closesFence(line, fence)) {
        fence = null
        if (cur!.kind === 'fence') close()
      }
      continue
    }

    if (BLANK.test(line)) {
      afterBlank = true
      continue
    }

    const wasAfterBlank = afterBlank
    afterBlank = false

    if (HEADING.test(line)) {
      close()
      heading = line.trim()
      index = 0
      continue
    }

    const open = FENCE_OPEN.exec(line)

    if (TOP_ITEM.test(line)) {
      close()
      cur = { start: i, end: i + 1, kind: 'item' }
      continue
    }

    if (cur && (!wasAfterBlank || (cur.kind === 'item' && /^\s/.test(line)))) {
      cur.end = i + 1
      if (open) fence = open[1]!
      continue
    }

    close()

    if (line.trimStart().startsWith('<!--')) {
      while (i < lines.length - 1 && !bare(lines[i]!).includes('-->')) i++
      continue
    }

    if (open) {
      cur = { start: i, end: i + 1, kind: 'fence' }
      fence = open[1]!
      continue
    }

    cur = { start: i, end: i + 1, kind: 'paragraph' }
  }
  close()

  return { lines, rules, eol, finalNewline }
}

/** The text a change brings, split on its own line breaks so it takes the file's. */
const linesOf = (text: string) => text.split(/\r?\n/)

/**
 * The text with changes applied: off removes the rule's lines; edit replaces line `lineIndex` of the
 * rule; addLine inserts after `afterLineIndex` (-1 inserts before the first). Off wins over the rule's
 * other changes; a line index outside the rule is ignored. Unknown ids are reported, not applied.
 */
export function renderRules(file: ParsedFile, changes: Record<string, HeadspaceRuleChange[]>): { text: string; unknown: string[] } {
  const byId = new Map(file.rules.map(r => [r.id, r]))
  const unknown = Object.keys(changes).filter(id => !byId.has(id))

  /** For each line of the file: what to write in its place (empty to drop it), and what to add before or after it. */
  const replaced = new Map<number, string[]>()
  const before = new Map<number, string[]>()
  const after = new Map<number, string[]>()
  const push = (map: Map<number, string[]>, at: number, text: string) => map.set(at, [...(map.get(at) ?? []), ...linesOf(text)])

  for (const [id, list] of Object.entries(changes)) {
    const rule = byId.get(id)
    if (!rule) continue
    if (list.some(c => c.type === 'off')) {
      for (let at = rule.start; at < rule.end; at++) replaced.set(at, [])
      continue
    }
    const size = rule.end - rule.start
    for (const change of list) {
      if (change.type === 'edit' && change.lineIndex >= 0 && change.lineIndex < size) {
        replaced.set(rule.start + change.lineIndex, linesOf(change.text))
      } else if (change.type === 'addLine' && change.afterLineIndex === -1) {
        push(before, rule.start, change.text)
      } else if (change.type === 'addLine' && change.afterLineIndex >= 0 && change.afterLineIndex < size) {
        push(after, rule.start + change.afterLineIndex, change.text)
      }
    }
  }

  const out: string[] = []
  file.lines.forEach((line, at) => {
    out.push(...(before.get(at) ?? []))
    out.push(...(replaced.get(at) ?? [line]))
    out.push(...(after.get(at) ?? []))
  })

  const text = out.join(file.eol) + (file.finalNewline && out.length > 0 ? file.eol : '')
  return { text, unknown }
}

/** Lines for a diff: line ends dropped, a final newline not counted as an empty last line. */
const diffSplit = (text: string) => {
  if (text === '') return []
  const lines = text.split(/\r?\n/)
  if (/\r?\n$/.test(text)) lines.pop()
  return lines
}

/** A line diff for the save confirmation: each line `{ type: 'same' | 'out' | 'in', text }`. LCS on lines. */
export function diffLines(before: string, after: string): { type: 'same' | 'out' | 'in'; text: string }[] {
  const a = diffSplit(before)
  const b = diffSplit(after)
  const n = a.length
  const m = b.length

  // lcs[i][j]: the longest common subsequence of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  const diff: { type: 'same' | 'out' | 'in'; text: string }[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      diff.push({ type: 'same', text: a[i]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      diff.push({ type: 'out', text: a[i]! })
      i++
    } else {
      diff.push({ type: 'in', text: b[j]! })
      j++
    }
  }
  while (i < n) diff.push({ type: 'out', text: a[i++]! })
  while (j < m) diff.push({ type: 'in', text: b[j++]! })
  return diff
}
