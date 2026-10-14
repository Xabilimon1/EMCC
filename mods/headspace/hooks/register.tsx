import { atom, read, update } from 'claude-code'
import type {
  ApiMessage,
  ElementConstructor,
  ElementTable,
  EngineInterface,
  InputProps,
  InstructionFile,
  PromptContextBlock,
  Register,
  RenderElement,
} from 'claude-code'

import type { HeadspaceFileChanges, HeadspaceKind, HeadspaceRuleChange, HeadspaceSnapshot } from '../types'
import { COLOURS, ORDER, fallback, formatTokens, toSegments, widths } from './bar'
import type { Category } from './bar'
import { cacheCost, cutInstructions, label, largeResults } from './large'
import type { LargeResult } from './large'
import { memoryEntries, renderMemory } from './memory'
import { diffLines, parseRules, renderRules } from './rules'

const COMMAND = 'headspace'
const PANE = 'headspace'
/** The source auto-memory changes are filed under. */
const MEMORY = 'memory'
const SESSION_RULES = 'sessionRules'
const DEFAULT_THRESHOLD = 2000

// ---------------------------------------------------------------- state

const snapshot = atom({ plugin: 'headspace', key: 'snapshot' } as const, null)
const pending = atom({ plugin: 'headspace', key: 'pending' } as const, [])
const applied = atom({ plugin: 'headspace', key: 'applied' } as const, [])
const sessionRules = atom({ plugin: 'headspace', key: 'sessionRules' } as const, [])
const pendingSessionRules = atom({ plugin: 'headspace', key: 'pendingSessionRules' } as const, null)
const marks = atom({ plugin: 'headspace', key: 'marks' } as const, [])
const staleCount = atom({ plugin: 'headspace', key: 'staleCount' } as const, 0)
const selected = atom({ plugin: 'headspace', key: 'selected' } as const, 'rules')
const cursor = atom({ plugin: 'headspace', key: 'cursor' } as const, null)
const isCutting = atom({ plugin: 'headspace', key: 'isCutting' } as const, false)
const lostAt = atom({ plugin: 'headspace', key: 'lostAt' } as const, null)

/** The large results threshold, in tokens: the `threshold` userConfig field. */
let threshold = DEFAULT_THRESHOLD
/** Between `turn.start` and the main loop's `turn.complete`: a cut waits for the person's move. */
let isTurnRunning = false
/** What the last refresh found, for the pane: the large results and the live conversation they came from. */
let lastLarge: LargeResult[] = []
let lastApi: ApiMessage[] = []
/** The instruction files and the memory section as the engine last gave them, for the pane's rows. */
let lastFiles: readonly InstructionFile[] = []
let lastMemory: string | null = null
/** The breakdown's categories and its Messages figure at the last refresh, for the pane's read-only kinds and the cut's cost. */
let lastCategories: Category[] = []
let lastMessageTokens: number | null = null
/** Why the last cut did not happen (a refusal or a skip): shown in the pane, never a crash. */
let cutNotice: string | null = null

async function lose($: EngineInterface, where: string): Promise<void> {
  try {
    await update($, lostAt, () => where)
  } catch {
    // Nothing left to record with.
  }
}

// ---------------------------------------------------------------- the bar

/** Session rules counted as the bar counts text: characters over four. */
function tokensOf(rules: readonly string[]): number {
  return Math.round(rules.reduce((sum, rule) => sum + rule.length, 0) / 4)
}

/**
 * Reads the breakdown and the live conversation into a new snapshot, and drops
 * the marks whose result is no longer there. No breakdown (a `-p` run, no bound
 * session): the snapshot is left as it stands.
 */
async function refresh($: EngineInterface): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const breakdown = usage.context.breakdown
  if (breakdown === undefined) {
    return
  }
  const api = await $.session.messages({ as: 'api' })
  const categories: Category[] = breakdown.categories.map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind }))
  const messageTokens = breakdown.categories.find(c => c.kind === 'used' && c.name === 'Messages')?.tokens ?? null
  const { results, share } = largeResults(api, threshold, messageTokens, await $.session.cwd())
  const segments = toSegments(categories, share, tokensOf(await read($, sessionRules)))
  const at = await $.clock.now()
  lastApi = api
  lastLarge = results
  lastCategories = categories
  lastMessageTokens = messageTokens
  await update($, snapshot, () => ({ segments, window: breakdown.rawMaxTokens, percent: breakdown.percentage, at }))
  const live = new Set(results.map(r => r.id))
  const marked = await read($, marks)
  if (!marked.every(m => live.has(m.id))) {
    await update($, marks, () => marked.filter(m => live.has(m.id)))
  }
}

// ---------------------------------------------------------------- rules

/** Every change of a rule in force or waiting: what pending says for it, else what applied says. */
async function changesOf($: EngineInterface, source: string, ruleId: string): Promise<HeadspaceRuleChange[]> {
  const waiting = (await read($, pending)).find(f => f.source === source)?.changes[ruleId]
  if (waiting !== undefined) {
    return waiting
  }

  return (await read($, applied)).find(f => f.source === source)?.changes[ruleId] ?? []
}

/** Writes a rule's whole list of changes into pending: it replaces that rule's list in applied at Apply. */
async function setPending($: EngineInterface, source: string, ruleId: string, list: HeadspaceRuleChange[]): Promise<void> {
  await update($, pending, files => {
    const others = files.filter(f => f.source !== source)
    const own = files.find(f => f.source === source)

    return [...others, { source, changes: { ...(own?.changes ?? {}), [ruleId]: list } }]
  })
}

/** Turns a rule off, or back on, from the next Apply. */
async function toggleRule($: EngineInterface, source: string, ruleId: string): Promise<void> {
  const list = await changesOf($, source, ruleId)
  const isOff = list.some(c => c.type === 'off')
  await setPending($, source, ruleId, isOff ? list.filter(c => c.type !== 'off') : [...list, { type: 'off' }])
}

/** Replaces line `lineIndex` of a rule with `text`; a second edit of the same line replaces the first. */
async function editLine($: EngineInterface, source: string, ruleId: string, lineIndex: number, text: string): Promise<void> {
  const list = await changesOf($, source, ruleId)
  const others = list.filter(c => !(c.type === 'edit' && c.lineIndex === lineIndex))
  await setPending($, source, ruleId, [...others, { type: 'edit', lineIndex, text }])
}

/** Adds a line after line `afterLineIndex` of a rule (-1: before its first). */
async function addLine($: EngineInterface, source: string, ruleId: string, afterLineIndex: number, text: string): Promise<void> {
  const list = await changesOf($, source, ruleId)
  await setPending($, source, ruleId, [...list, { type: 'addLine', afterLineIndex, text }])
}

async function addSessionRule($: EngineInterface, text: string): Promise<void> {
  const rule = text.trim()
  if (rule === '') {
    return
  }
  const base = (await read($, pendingSessionRules)) ?? (await read($, sessionRules))
  await update($, pendingSessionRules, () => [...base, rule])
}

async function removeSessionRule($: EngineInterface, index: number): Promise<void> {
  const base = (await read($, pendingSessionRules)) ?? (await read($, sessionRules))
  await update($, pendingSessionRules, () => base.filter((_, at) => at !== index))
}

/** Pending's rule lists replace applied's, rule by rule; an empty list takes the rule's changes away. */
function merged(inForce: readonly HeadspaceFileChanges[], waiting: readonly HeadspaceFileChanges[]): HeadspaceFileChanges[] {
  const bySource = new Map<string, Record<string, HeadspaceRuleChange[]>>()
  for (const file of inForce) {
    bySource.set(file.source, { ...file.changes })
  }
  for (const file of waiting) {
    const changes = bySource.get(file.source) ?? {}
    for (const [ruleId, list] of Object.entries(file.changes)) {
      if (list.length === 0) {
        delete changes[ruleId]
      } else {
        changes[ruleId] = list
      }
    }
    bySource.set(file.source, changes)
  }

  return [...bySource]
    .filter(([, changes]) => Object.keys(changes).length > 0)
    .map(([source, changes]) => ({ source, changes }))
}

/** Puts every waiting change in force; the context and the memory section are computed again for the next request. Answers how many rules changed. */
async function applyRules($: EngineInterface): Promise<number> {
  const waiting = await read($, pending)
  const rules = await read($, pendingSessionRules)
  const count = waiting.reduce((sum, f) => sum + Object.keys(f.changes).length, 0) + (rules === null ? 0 : 1)
  if (waiting.length > 0) {
    const inForce = await read($, applied)
    await update($, applied, () => merged(inForce, waiting))
    await update($, pending, () => [])
  }
  if (rules !== null) {
    await update($, sessionRules, () => rules)
    await update($, pendingSessionRules, () => null)
  }
  // The person has seen the bar's stale line and chosen again: it starts over.
  await update($, staleCount, () => 0)
  $.ui.invalidate('prompt.context')
  $.ui.invalidate('prompt.section')

  return count
}

/** How many single changes a file's list holds for these rules. */
function countChanges(changes: Record<string, HeadspaceRuleChange[]>, ids: readonly string[]): number {
  return ids.reduce((sum, id) => sum + (changes[id]?.length ?? 0), 0)
}

/**
 * The `claudeMd` block with the applied changes of each file it frames: the
 * file's loaded text replaced, once, by the text rendered without its rules
 * turned off. Changes whose rule is gone, or whose file text is not found in
 * the block, are dropped from applied and counted stale. Changes a save wrote
 * into the file leave quietly once the engine hands that file's new text.
 */
async function rewriteClaudeMd($: EngineInterface, block: PromptContextBlock, files: readonly InstructionFile[]): Promise<PromptContextBlock> {
  const inForce = (await read($, applied)).filter(f => f.source !== MEMORY)
  let text = block.text
  let stale = 0
  let isDropped = false
  const kept: HeadspaceFileChanges[] = []
  for (const original of inForce) {
    let entry = original
    const file = files.find(f => f.path === entry.source)
    if (file === undefined) {
      // Not loaded in this context (a nested file not read yet): kept for when it is.
      kept.push(entry)
      continue
    }
    const saved = savedFrom.get(entry.source)
    if (saved !== undefined && file.content !== saved.loaded) {
      // The engine read the saved file: those changes are in its text now, never stale.
      savedFrom.delete(entry.source)
      entry = { source: entry.source, changes: Object.fromEntries(Object.entries(entry.changes).filter(([id]) => !saved.ids.includes(id))) }
      isDropped = true
      if (Object.keys(entry.changes).length === 0) {
        continue
      }
    }
    const { text: rendered, unknown } = renderRules(parseRules(file.content), entry.changes)
    const at = text.indexOf(file.content)
    if (at === -1) {
      stale += countChanges(entry.changes, Object.keys(entry.changes))
      continue
    }
    stale += countChanges(entry.changes, unknown)
    text = text.slice(0, at) + rendered + text.slice(at + file.content.length)
    const changes = Object.fromEntries(Object.entries(entry.changes).filter(([id]) => !unknown.includes(id)))
    if (Object.keys(changes).length > 0) {
      kept.push({ source: entry.source, changes })
    }
  }
  if (stale > 0 || isDropped) {
    const memory = (await read($, applied)).filter(f => f.source === MEMORY)
    await update($, applied, () => [...kept, ...memory])
  }
  if (stale > 0) {
    await update($, staleCount, count => count + stale)
  }

  return text === block.text ? block : { name: block.name, text }
}

// ---------------------------------------------------------------- save and undo

/** How many saves of one file `$.store` keeps to undo. */
const MAX_BACKUPS = 10
const SESSION_HEADING = '## Session rules'
/** At most this many changed lines in a confirmation; the rest are counted. */
const DIFF_LINES = 30

type Backup = { at: number; text: string }

/**
 * Per file saved this session: the text the engine held for it when the save
 * went through, and the rules that save wrote. The engine may go on handing
 * that text until it reads the file again (a compaction, /clear), so those
 * changes stay in force until its text differs, then leave applied quietly.
 */
const savedFrom = new Map<string, { loaded: string; ids: string[] }>()

/** The last save's outcome per source (a path, or SESSION_RULES), shown in the pane under its group. */
const saveNotices = new Map<string, string>()

function backupKey(path: string): string {
  return `backup:${path}`
}

async function backupsOf($: EngineInterface, path: string): Promise<Backup[]> {
  const value = (await $.store.get(backupKey(path))) as { saves?: unknown } | undefined
  const saves = Array.isArray(value?.saves) ? (value.saves as unknown[]) : []

  return saves.filter((s): s is Backup => typeof s === 'object' && s !== null && typeof (s as Backup).text === 'string' && typeof (s as Backup).at === 'number')
}

/** Shows the outcome under the group, and as a toast; answers it. */
function notify($: EngineInterface, source: string, text: string): string {
  saveNotices.set(source, text)
  $.ui.toast(text)
  $.ui.invalidate('ui.render')

  return text
}

/** The changed lines between two texts, `- ` out and `+ ` in, as a confirmation shows them. */
function diffText(before: string, after: string): string {
  const changed = diffLines(before, after).filter(line => line.type !== 'same')
  const shownLines = changed.slice(0, DIFF_LINES).map(line => `${line.type === 'out' ? '-' : '+'} ${line.text}`)
  const more = changed.length - shownLines.length

  return [...shownLines, ...(more > 0 ? [`and ${count(more, 'more line')}`] : [])].join('\n')
}

/** Asks with `yes` and Cancel; a dismissed question is a Cancel. */
async function confirm($: EngineInterface, question: string, yes: string): Promise<boolean> {
  try {
    return (await $.ui.ask(question, [yes, 'Cancel'])) === yes
  } catch {
    return false
  }
}

/** A file's text, or '' when it is not there yet. */
async function readOrEmpty($: EngineInterface, path: string): Promise<string> {
  return (await $.fs.exists(path)) ? await $.fs.read(path) : ''
}

/**
 * Writes `text` over `path`, which held `disk` when it was read: refused when
 * the file changed since; else `disk` is kept first as the newest backup (ten
 * at most). Answers the refusal, or null once written.
 */
async function writeKeepingBackup($: EngineInterface, path: string, disk: string, text: string): Promise<string | null> {
  if ((await readOrEmpty($, path)) !== disk) {
    return 'changed on disk, nothing written'
  }
  const saves = [...(await backupsOf($, path)), { at: await $.clock.now(), text: disk }].slice(-MAX_BACKUPS)
  await $.store.set(backupKey(path), { saves })
  await $.fs.write(path, text)

  return null
}

/**
 * Writes a file's applied changes into the file on disk, after showing the
 * diff and asking. Rule ids are worked out on the disk text: a change whose
 * rule reads otherwise there is not saved, stays in force, and is counted.
 * The saved changes leave applied once the engine reads the saved file
 * (savedFrom); until then they keep the rule out of what Claude reads.
 */
async function save($: EngineInterface, source: string): Promise<string> {
  try {
    // An organization's file: the pane offers no save, and a drawing older than the engine's last read is refused here.
    if (lastFiles.find(f => f.path === source)?.kind === 'managed') {
      return notify($, source, 'managed files are read-only')
    }
    const entry = (await read($, applied)).find(f => f.source === source)
    if (entry === undefined) {
      return notify($, source, 'nothing applied to save')
    }
    // Changes an earlier save wrote are in the file already: only the others are saved now.
    const written = savedFrom.get(source)?.ids ?? []
    const changes = Object.fromEntries(Object.entries(entry.changes).filter(([id]) => !written.includes(id)))
    const disk = await $.fs.read(source)
    const { text, unknown } = renderRules(parseRules(disk), changes)
    const lost = countChanges(changes, unknown)
    const lostLine = lost > 0 ? `${count(lost, 'change')} cannot be saved: the rule differs on disk` : null
    if (text === disk) {
      return notify($, source, lostLine ?? 'nothing to save')
    }
    if (!(await confirm($, `${diffText(disk, text)}\n\nSave these changes to ${source}?`, 'Save'))) {
      return notify($, source, 'nothing written')
    }
    const refusal = await writeKeepingBackup($, source, disk, text)
    if (refusal !== null) {
      return notify($, source, refusal)
    }
    const saved = Object.keys(changes).filter(id => !unknown.includes(id))
    const loaded = lastFiles.find(f => f.path === source)?.content
    if (loaded === undefined) {
      // The engine has not read this file into the context: it will read the saved text, so the changes leave now.
      await update($, applied, files =>
        files
          .map(f => (f.source === source ? { source, changes: Object.fromEntries(Object.entries(f.changes).filter(([id]) => !saved.includes(id))) } : f))
          .filter(f => Object.keys(f.changes).length > 0),
      )
    } else {
      // Until the engine reads the file again it hands the old text: the saved changes stay in force over it.
      savedFrom.set(source, { loaded, ids: [...written, ...saved] })
    }
    $.ui.invalidate('prompt.context')

    return notify($, source, lostLine === null ? `saved to ${source}` : `saved to ${source}; ${lostLine}`)
  } catch (error) {
    return notify($, source, `nothing written: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Puts back the file as it was before its last save, after showing the diff
 * and asking. Written as a save is: refused when the file changed while the
 * question was open, and what it writes over kept first as the newest backup.
 * The backup it restored is used up only once the write went through.
 */
async function undoSave($: EngineInterface, source: string): Promise<string> {
  try {
    const last = (await backupsOf($, source)).at(-1)
    if (last === undefined) {
      return notify($, source, 'no save to undo')
    }
    const current = await readOrEmpty($, source)
    if (!(await confirm($, `${diffText(current, last.text)}\n\nRestore ${source} to how it was before the last save?`, 'Restore'))) {
      return notify($, source, 'nothing written')
    }
    const refusal = await writeKeepingBackup($, source, current, last.text)
    if (refusal !== null) {
      return notify($, source, refusal)
    }
    // The restored backup sits just under the one this write kept.
    const saves = await backupsOf($, source)
    await $.store.set(backupKey(source), { saves: saves.filter((_, at) => at !== saves.length - 2) })
    // The file is as it was before the save; the changes that save wrote stay in force for this session, as before it.
    savedFrom.delete(source)
    $.ui.invalidate('prompt.context')

    return notify($, source, `restored ${source}`)
  } catch (error) {
    return notify($, source, `nothing written: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** `text` with `- rule` added at the end of its `## Session rules` section, the section made at the end when absent. */
function withSessionRule(text: string, rule: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text === '' ? [] : text.split(eol)
  if (lines.at(-1) === '') {
    lines.pop()
  }
  const item = `- ${rule}`
  const heading = lines.findIndex(line => line.trim() === SESSION_HEADING)
  if (heading === -1) {
    const gap = lines.length > 0 && lines.at(-1)?.trim() !== '' ? [''] : []

    return [...lines, ...gap, SESSION_HEADING, '', item].join(eol) + eol
  }
  const next = lines.findIndex((line, at) => at > heading && /^ {0,3}#{1,6}(?:[ \t]|$)/.test(line))
  let end = next === -1 ? lines.length : next
  while (end > heading + 1 && lines[end - 1]?.trim() === '') {
    end--
  }
  const gap = end === heading + 1 ? [''] : []

  return [...lines.slice(0, end), ...gap, item, ...lines.slice(end)].join(eol) + eol
}

/** Saves a session rule into the project's CLAUDE.md or the person's, as they choose, after showing the diff and asking. */
async function saveSessionRule($: EngineInterface, rule: string): Promise<string> {
  try {
    let where: string
    try {
      where = await $.ui.ask('Save this rule to which CLAUDE.md?', ['Project', 'User', 'Cancel'])
    } catch {
      where = 'Cancel'
    }
    let path: string
    if (where === 'Project') {
      path = `${await $.session.root()}/CLAUDE.md`
    } else if (where === 'User') {
      const config = await $.env.get('CLAUDE_CONFIG_DIR')
      const home = await $.env.get('HOME')
      if (config === undefined && home === undefined) {
        return notify($, SESSION_RULES, 'cannot find your CLAUDE.md: HOME is not set')
      }
      path = `${config ?? `${home}/.claude`}/CLAUDE.md`
    } else {
      return notify($, SESSION_RULES, 'nothing written')
    }
    const disk = await readOrEmpty($, path)
    const text = withSessionRule(disk, rule)
    if (!(await confirm($, `${diffText(disk, text)}\n\nSave these changes to ${path}?`, 'Save'))) {
      return notify($, SESSION_RULES, 'nothing written')
    }
    const refusal = await writeKeepingBackup($, path, disk, text)
    if (refusal !== null) {
      return notify($, SESSION_RULES, refusal)
    }
    $.ui.invalidate('prompt.context')

    return notify($, SESSION_RULES, `saved to ${path}`)
  } catch (error) {
    return notify($, SESSION_RULES, `nothing written: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ---------------------------------------------------------------- large results

async function isCutReady($: EngineInterface): Promise<boolean> {
  try {
    return (await $.state.get({ plugin: 'headspace-cut', key: 'ready' })).value === true
  } catch {
    return false
  }
}

/** Why a cut cannot run now, or null when it can. */
async function cutRefusal($: EngineInterface): Promise<string | null> {
  if (isTurnRunning) {
    return 'Claude is working: remove results between turns'
  }
  if (await read($, isCutting)) {
    return 'a removal is already running'
  }
  if ((await read($, marks)).length === 0) {
    return 'no results marked'
  }
  if (!(await isCutReady($))) {
    return 'install headspace-cut to remove results'
  }

  return null
}

async function toggleMark($: EngineInterface, id: string): Promise<void> {
  const found = lastLarge.find(r => r.id === id)
  await update($, marks, list => {
    if (list.some(m => m.id === id)) {
      return list.filter(m => m.id !== id)
    }

    return found === undefined ? list : [...list, { id, label: label(found) }]
  })
}

/**
 * Removes the marked results: a compaction headspace-cut answers. Refused (the
 * reason answered, and kept for the pane) while a turn runs, while a cut is in
 * flight, with nothing marked, or without headspace-cut. A skip keeps the marks.
 */
async function applyCut($: EngineInterface): Promise<string | null> {
  const refusal = await cutRefusal($)
  if (refusal !== null) {
    // The pane works the refusal out again as it draws: nothing to keep.
    return refusal
  }
  cutNotice = null
  await update($, isCutting, () => true)
  try {
    const result = await $.session.compact({ instructions: cutInstructions(await read($, marks)) })
    if (result.skip !== undefined) {
      cutNotice = result.skip
      $.ui.toast(result.skip)

      return result.skip
    }
    await update($, marks, () => [])
  } catch (error) {
    // The engine refused the compaction (a turn started meanwhile): nothing changed.
    cutNotice = `nothing removed: ${error instanceof Error ? error.message : String(error)}`
    $.ui.toast(cutNotice)

    return cutNotice
  } finally {
    await update($, isCutting, () => false)
  }
  await refresh($)

  return null
}

// ---------------------------------------------------------------- the pane

async function openOn($: EngineInterface, kind: HeadspaceKind): Promise<void> {
  await update($, selected, () => kind)
  await update($, cursor, () => null)
  await $.ui.open({ id: PANE, title: 'headspace', closeOnEscape: true, focus: true })
  await refresh($)
}

function isKind(word: string): word is HeadspaceKind {
  return (ORDER as readonly string[]).includes(word)
}

// ---------------------------------------------------------------- drawing

/** Each kind lit under the pointer: a lighter shade of its colour. */
const LIGHTER: Record<HeadspaceKind, string> = {
  system: '#d1cfc6', rules: '#e9a58a', conversation: '#9cbde0', large: '#a5b78a', free: '#f4f3ee', reserve: '#d1cfc6',
}
const STONE = COLOURS.system
const CLAY = COLOURS.rules
/** What the bar leaves beside it for the text, per fallback. */
const BESIDE: Record<ReturnType<typeof fallback>, number> = { full: 50, counts: 30, bare: 6 }
const BAR_MAX = 60
const BAR_MIN = 6

type Els = Pick<ElementTable, 'Box' | 'Text' | 'Button'>
type InputEl = ElementConstructor<InputProps> | undefined

/** `1 rule`, `3 rules`. */
function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** A one-line cut of `text` to `columns` cells, with an ellipsis when cut. */
function cut(text: string, columns: number): string {
  const room = Math.max(4, columns)

  return text.length <= room ? text : text.slice(0, room - 1) + '…'
}

/** Characters over four, as the bar counts text it has no figure for. */
function estimate(text: string): number {
  return Math.round(text.length / 4)
}

/** The categories behind a read-only kind, as the breakdown named them. */
function categoriesOf(kind: HeadspaceKind): Category[] {
  return lastCategories.filter(c => {
    if (c.kind === 'deferred') {
      return false
    }
    if (kind === 'free') {
      return c.kind === 'free'
    }
    if (kind === 'reserve') {
      return c.kind === 'buffer'
    }
    if (kind === 'conversation') {
      return c.kind === 'used' && c.name === 'Messages'
    }

    return kind === 'system' && c.kind === 'used' && c.name !== 'Messages' && c.name !== 'Memory files'
  })
}

/** One file's rows for the pane: a file behind claudeMd, or the auto-memory index. */
type RuleGroup = { source: string; title: string; isManaged: boolean; isMemory: boolean; rules: { id: string; lines: string[]; first: string }[] }

function ruleGroups(): RuleGroup[] {
  const groups: RuleGroup[] = lastFiles.map(file => ({
    source: file.path,
    title: `${file.path}  ${file.kind}  ${formatTokens(estimate(file.content))}`,
    isManaged: file.kind === 'managed',
    isMemory: false,
    rules: parseRules(file.content).rules.map(rule => ({ id: rule.id, lines: rule.lines, first: rule.lines[0] ?? '' })),
  }))
  if (lastMemory !== null) {
    const entries = memoryEntries(lastMemory)
    if (entries.length > 0) {
      groups.push({
        source: MEMORY,
        title: `auto-memory  memory  ${formatTokens(estimate(entries.map(e => e.line).join('\n')))}`,
        isManaged: false,
        isMemory: true,
        rules: entries.map(entry => ({ id: entry.id, lines: [entry.line], first: entry.title })),
      })
    }
  }

  return groups
}

/** A rule's changes as the pane shows them: pending's list, else applied's. */
function effective(waiting: readonly HeadspaceFileChanges[], inForce: readonly HeadspaceFileChanges[], source: string, id: string): HeadspaceRuleChange[] {
  return waiting.find(f => f.source === source)?.changes[id] ?? inForce.find(f => f.source === source)?.changes[id] ?? []
}

/** The rules turned off and in force, every file and the memory together. */
function offCount(inForce: readonly HeadspaceFileChanges[]): number {
  return inForce.reduce((sum, file) => sum + Object.values(file.changes).filter(list => list.some(c => c.type === 'off')).length, 0)
}

/** Where the pane's cursor is: a rule (its file, id and selected line) or a large result. */
type Cursor = { type: 'rule'; source: string; id: string; line: number } | { type: 'large'; id: string }

function cursorOf(text: string | null): Cursor | null {
  if (text === null) {
    return null
  }
  try {
    const value = JSON.parse(text) as unknown[]
    if (value[0] === 'rule' && typeof value[1] === 'string' && typeof value[2] === 'string') {
      return { type: 'rule', source: value[1], id: value[2], line: typeof value[3] === 'number' ? value[3] : 0 }
    }
    if (value[0] === 'large' && typeof value[1] === 'string') {
      return { type: 'large', id: value[1] }
    }
  } catch {
    // Not a cursor of this version: nothing selected.
  }

  return null
}

/** Runs a button's work; a failure is recorded, never thrown at the surface. */
function press($: EngineInterface, where: string, work: () => Promise<unknown>): void {
  void work().catch(() => lose($, where))
}

/** The pieces a kind holds, for its card: rules, results, parts, messages. */
function pieces(kind: HeadspaceKind, rules: readonly string[]): string | null {
  switch (kind) {
    case 'rules':
      return count(ruleGroups().reduce((sum, g) => sum + g.rules.length, 0) + rules.length, 'rule')
    case 'large':
      return count(lastLarge.length, 'result')
    case 'conversation':
      return count(lastApi.length, 'message')
    case 'system':
      return count(categoriesOf('system').length, 'part')
    default:
      return null
  }
}

/**
 * The hover group a kind's segment and its card share: the pointer on the
 * segment shows the card in the labels' place, in the band's own row (an
 * absolute Box is clipped to the band, so a card above a one-row band would
 * never show).
 */
function scopeOf(kind: HeadspaceKind): string {
  return `headspace-${kind}`
}

/** One segment of the bar: its cells, and the same cells as a button under the pointer. */
function segment($: EngineInterface, { Box, Text, Button }: Els, kind: HeadspaceKind, width: number): RenderElement {
  const run = (kind === 'reserve' ? '░' : '█').repeat(width)
  const hover = { scope: scopeOf(kind), color: LIGHTER[kind] }

  return (
    <Box key={`seg-${kind}`} flexShrink={0}>
      <Text color={COLOURS[kind]} dimColor={kind === 'free' ? true : undefined} hover={hover}>
        {run}
      </Text>
      <Box position="absolute" top={0} left={0} display="none" hover={{ display: 'flex' }}>
        <Button key={`open-${kind}`} plain label={run} hover={hover} onPress={() => press($, 'ui.press', () => openOn($, kind))} />
      </Box>
    </Box>
  )
}

/** What a kind's card says: `rules 4k  12 rules  click to view and remove`. */
function cardText(kind: HeadspaceKind, tokens: number, rules: readonly string[]): string {
  const what = pieces(kind, rules)
  const action = kind === 'rules' || kind === 'large' ? 'click to view and remove' : 'view only'

  return [`${kind} ${formatTokens(tokens)}`, what, action].filter((part): part is string => part !== null).join('  ')
}

/**
 * A kind's card, drawn over the labels after the bar while the pointer is on
 * its segment: one line, padded to the labels' width so none shows through.
 */
function card({ Box, Text }: Els, kind: HeadspaceKind, text: string, room: number): RenderElement {
  return (
    <Box key={`card-${kind}`} position="absolute" top={0} left={0} width={room} display="none" hover={{ display: 'flex', scope: scopeOf(kind) }}>
      <Text color={COLOURS[kind]} wrap="truncate-end">
        {cut(text, room).padEnd(room)}
      </Text>
    </Box>
  )
}

/** The kinds as tabs: the selected one drawn inverse, the others pressable. */
function tabs($: EngineInterface, { Box, Text, Button }: Els, shown: HeadspaceKind): RenderElement {
  return (
    <Box gap={2} flexWrap="wrap">
      {ORDER.map(kind =>
        kind === shown ? (
          <Text key={`tab-${kind}-on`} color={COLOURS[kind]} inverse bold>
            {` ${kind} `}
          </Text>
        ) : (
          <Box key={`tab-box-${kind}`} gap={1}>
            <Text color={COLOURS[kind]} dimColor={kind === 'free' ? true : undefined}>
              {kind === 'reserve' ? '░' : '█'}
            </Text>
            <Button key={`tab-${kind}`} plain label={kind} onPress={() => press($, 'ui.press', () => showKind($, kind))} />
          </Box>
        ),
      )}
    </Box>
  )
}

async function showKind($: EngineInterface, kind: HeadspaceKind): Promise<void> {
  await update($, selected, () => kind)
  await update($, cursor, () => null)
}

async function select($: EngineInterface, value: Cursor | null): Promise<void> {
  const text = value === null ? null : JSON.stringify(value.type === 'rule' ? ['rule', value.source, value.id, value.line] : ['large', value.id])
  await update($, cursor, () => text)
}

/** The rules tab: each file's rules, the session rules, and apply. */
async function rulesBody($: EngineInterface, { Box, Text, Button }: Els, Input: InputEl, columns: number, at: Cursor | null): Promise<RenderElement> {
  const waiting = await read($, pending)
  const inForce = await read($, applied)
  const shot = await read($, snapshot)
  const rules = (await read($, pendingSessionRules)) ?? (await read($, sessionRules))
  const groups = ruleGroups()
  const waitingCount = waiting.reduce((sum, f) => sum + Object.keys(f.changes).length, 0) + ((await read($, pendingSessionRules)) === null ? 0 : 1)
  // What a changed context costs: everything from the first user message on, where claudeMd and the
  // session rules sit. The tools and the system prompt come before it and stay cached, save when an
  // auto-memory entry changes: the memory index is part of the system prompt.
  const rewritten: HeadspaceKind[] = waiting.some(f => f.source === MEMORY) ? ['system', 'rules', 'conversation', 'large'] : ['rules', 'conversation', 'large']
  const used = (shot?.segments ?? []).filter(s => rewritten.includes(s.kind)).reduce((sum, s) => sum + s.tokens, 0)
  /** Whether each group's file has a save to undo: only files headspace may write. */
  const undoable = await Promise.all(groups.map(async g => !g.isManaged && !g.isMemory && (await backupsOf($, g.source).catch(() => [])).length > 0))
  const sessionNotice = saveNotices.get(SESSION_RULES)

  return (
    <Box flexDirection="column" gap={1}>
      {groups.length === 0 && <Text color={STONE}>No instruction files read yet. They show after the next request.</Text>}
      {groups.map((group, g) => (
        <Box key={`group-${g}`} flexDirection="column">
          <Text bold wrap="truncate-start">
            {group.isManaged ? `${group.title}  managed` : group.title}
          </Text>
          {!group.isManaged && !group.isMemory && (
            <Box gap={2}>
              <Button key={`save-${g}`} plain label="save" onPress={() => press($, 'ui.press', () => save($, group.source))} />
              {undoable[g] === true && <Button key={`undo-${g}`} plain label="undo save" onPress={() => press($, 'ui.press', () => undoSave($, group.source))} />}
              {saveNotices.has(group.source) && <Text color={STONE}>{saveNotices.get(group.source)}</Text>}
            </Box>
          )}
          {group.rules.map((rule, r) => {
            const list = effective(waiting, inForce, group.source, rule.id)
            const isOff = list.some(c => c.type === 'off')
            const isAt = at?.type === 'rule' && at.source === group.source && at.id === rule.id
            const tokens = formatTokens(estimate(rule.lines.join('\n')))
            const first = cut(rule.first, columns - 12)

            return (
              <Box key={`rule-box-${g}-${r}`} flexDirection="column">
                <Box gap={1}>
                  <Text color={isOff ? STONE : CLAY}>{isOff ? '○' : '●'}</Text>
                  {group.isManaged ? (
                    <Text>{first}</Text>
                  ) : (
                    <Button
                      key={`rule-${g}-${r}`}
                      plain
                      label={first}
                      dimColor={isOff ? true : undefined}
                      onPress={() => press($, 'ui.press', () => select($, isAt ? null : { type: 'rule', source: group.source, id: rule.id, line: 0 }))}
                    />
                  )}
                  <Text color={STONE}>{tokens}</Text>
                </Box>
                {isAt && at?.type === 'rule' && (
                  <Box flexDirection="column" marginLeft={2}>
                    {rule.lines.map((line, l) =>
                      rule.lines.length === 1 || group.isMemory ? (
                        <Text key={`line-${l}`}>{line}</Text>
                      ) : (
                        <Button
                          key={`line-${l}`}
                          plain
                          label={l === at.line ? `> ${line}` : `  ${line}`}
                          onPress={() => press($, 'ui.press', () => select($, { type: 'rule', source: group.source, id: rule.id, line: l }))}
                        />
                      ),
                    )}
                    <Box gap={2}>
                      <Button key="toggle" label={isOff ? 'on' : 'off'} onPress={() => press($, 'ui.press', () => toggleRule($, group.source, rule.id))} />
                    </Box>
                    {Input !== undefined && !group.isMemory && (
                      <Input
                        key="edit"
                        label="edit "
                        value={list.find((c): c is Extract<HeadspaceRuleChange, { type: 'edit' }> => c.type === 'edit' && c.lineIndex === at.line)?.text ?? rule.lines[at.line] ?? ''}
                        onSubmit={value => press($, 'ui.input', () => editLine($, group.source, rule.id, at.line, value))}
                      />
                    )}
                    {Input !== undefined && !group.isMemory && (
                      <Input
                        key="add-line"
                        label="add line "
                        placeholder="a line below the selected one"
                        value=""
                        onSubmit={value => press($, 'ui.input', () => addLine($, group.source, rule.id, at.line, value))}
                      />
                    )}
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
      ))}
      <Box flexDirection="column">
        <Text bold>{`session rules  ${formatTokens(tokensOf(rules))}`}</Text>
        {rules.map((rule, i) => (
          <Box key={`session-${i}`} gap={1}>
            <Text color={CLAY}>●</Text>
            <Text>{rule}</Text>
            <Button key={`session-remove-${i}`} plain dimColor label="remove" onPress={() => press($, 'ui.press', () => removeSessionRule($, i))} />
            <Button key={`session-save-${i}`} plain dimColor label="save" onPress={() => press($, 'ui.press', () => saveSessionRule($, rule))} />
          </Box>
        ))}
        {sessionNotice !== undefined && <Text color={STONE}>{sessionNotice}</Text>}
        {Input !== undefined && (
          <Input key="session-rule" placeholder="add a session rule" value="" onSubmit={value => press($, 'ui.input', () => addSessionRule($, value))} />
        )}
      </Box>
      <Box gap={2}>
        <Button key="apply-rules" label="apply" variant="primary" onPress={() => press($, 'ui.press', () => applyRules($))} />
        <Text color={STONE}>{`rewrites ~${formatTokens(used)} of cache`}</Text>
        {waitingCount > 0 && <Text color={CLAY}>{count(waitingCount, 'change') + ' waiting'}</Text>}
      </Box>
    </Box>
  )
}

/** The large tab: the results biggest first, each marked or not, and apply. */
async function largeBody($: EngineInterface, { Box, Text, Button }: Els, columns: number, at: Cursor | null): Promise<RenderElement> {
  const marked = await read($, marks)
  const ids = new Set(marked.map(m => m.id))
  const refusal = await cutRefusal($)
  const frees = lastLarge.filter(r => ids.has(r.id)).reduce((sum, r) => sum + r.tokens, 0)
  const cost = cacheCost(lastApi, [...ids], lastMessageTokens)

  return (
    <Box flexDirection="column" gap={1}>
      {lastLarge.length === 0 && <Text color={STONE}>No tool result is that large.</Text>}
      <Box flexDirection="column">
        {lastLarge.map((result, i) => {
          const what = result.target === '' ? result.tool : `${result.tool} ${result.target}`
          const isAt = at?.type === 'large' && at.id === result.id

          return (
            <Box key={`large-${i}`} flexDirection="column">
              <Box gap={1}>
                <Button key={`mark-${i}`} plain label={ids.has(result.id) ? '[x]' : '[ ]'} onPress={() => press($, 'ui.press', () => toggleMark($, result.id))} />
                <Text wrap="truncate-end">{`${what}  ${formatTokens(result.tokens)}  ${count(result.turnsAgo, 'turn')} ago`}</Text>
                <Button key={`view-${i}`} plain dimColor label={isAt ? 'hide' : 'view'} onPress={() => press($, 'ui.press', () => select($, isAt ? null : { type: 'large', id: result.id }))} />
              </Box>
              {isAt && (
                <Box flexDirection="column" marginLeft={4}>
                  {result.preview.map((line, l) => (
                    <Text key={`preview-${l}`} color={STONE} wrap="truncate-end">
                      {cut(line, columns - 4)}
                    </Text>
                  ))}
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
      <Box gap={2}>
        <Button key="apply-cut" label="apply" dimColor={refusal === null ? undefined : true} onPress={() => press($, 'ui.press', () => applyCut($))} />
        <Text color={refusal === null ? undefined : STONE}>{refusal ?? `frees ${formatTokens(frees)}, rewrites ~${formatTokens(cost)}`}</Text>
      </Box>
      {refusal === null && cutNotice !== null && <Text color={CLAY}>{cutNotice}</Text>}
      <Text color={STONE}>Removing cannot be undone. Your prompts and Claude's answers stay.</Text>
    </Box>
  )
}

/** A read-only kind: the categories behind it, with their tokens. */
function categoriesBody({ Box, Text }: Els, kind: HeadspaceKind, tokens: number): RenderElement {
  const rows = categoriesOf(kind)

  return (
    <Box flexDirection="column">
      {rows.length === 0 && <Text color={STONE}>Nothing here yet.</Text>}
      {rows.map((row, i) => (
        <Text key={`category-${i}`}>{`${row.name}  ${formatTokens(kind === 'conversation' ? tokens : row.tokens)}`}</Text>
      ))}
      {kind === 'conversation' && <Text color={STONE}>The large tool results are counted under large.</Text>}
      <Text color={STONE}>view only</Text>
    </Box>
  )
}

/** One thing after the bar: a label that opens the pane on its kind (reachable with ctrl+x tab), or a line to read. */
type Item = { key: string; text: string; opens: HeadspaceKind | null }

/** Whether the band beneath drew nothing: no tree, or a Box or Text holding no text and no control. */
function isBlank(tree: RenderElement | null | undefined): boolean {
  if (tree === null || tree === undefined) {
    return true
  }
  if (tree.type !== 'Box' && tree.type !== 'Text') {
    return false
  }

  return (tree.children ?? []).every(child => (typeof child === 'string' ? child === '' : typeof child === 'object' && child !== null && 'type' in child && isBlank(child as RenderElement)))
}

/** The cards need at least this many cells beside the bar to say anything. */
const CARD_MIN = 12

/**
 * The band's row: the bar, the percentage, then per fallback the labels and
 * counts, each label a plain Button that opens the pane on its kind (the
 * keyboard's way in: ctrl+x tab, the arrows, Enter). The percentage opens it
 * on rules, so even a bare band has one. Under the pointer, a segment's card
 * takes the labels' place.
 */
async function bandRow($: EngineInterface, els: Els, shot: HeadspaceSnapshot, bodyColumns: number): Promise<RenderElement> {
  const { Box, Text, Button } = els
  const mode = fallback(bodyColumns)
  const columns = Math.max(BAR_MIN, Math.min(BAR_MAX, bodyColumns - BESIDE[mode]))
  const tokens = Object.fromEntries(shot.segments.map(s => [s.kind, s.tokens])) as Partial<Record<HeadspaceKind, number>>
  const rules = await read($, sessionRules)
  const off = offCount(await read($, applied))
  const marked = (await read($, marks)).length
  const stale = await read($, staleCount)
  const cells = widths(shot.segments, shot.window, columns).filter(cell => cell.width > 0)
  const percent = `${Math.round(shot.percent)}%`
  const counts: (Item | null)[] = [
    off > 0 ? { key: 'label-off', text: `${off} off`, opens: 'rules' } : null,
    marked > 0 ? { key: 'label-marked', text: `${marked} marked`, opens: 'large' } : null,
    stale > 0 ? { key: 'stale', text: stale === 1 ? '1 change no longer applies' : `${stale} changes no longer apply`, opens: null } : null,
  ]
  const labels: (Item | null)[] = [
    { key: 'label-rules', text: `rules ${formatTokens(tokens.rules ?? 0)}`, opens: 'rules' },
    counts[0] ?? null,
    (tokens.large ?? 0) > 0 ? { key: 'label-large', text: `large ${formatTokens(tokens.large ?? 0)}`, opens: 'large' } : null,
    counts[1] ?? null,
    counts[2] ?? null,
  ]
  const items = (mode === 'full' ? labels : mode === 'counts' ? counts : []).filter((item): item is Item => item !== null)
  // The cells the bar and the percentage leave, less the two gaps between them.
  const room = bodyColumns - cells.reduce((sum, cell) => sum + cell.width, 0) - percent.length - 4

  return (
    <Box gap={2}>
      <Box flexShrink={0}>{cells.map(cell => segment($, els, cell.kind, cell.width))}</Box>
      <Button key="label-percent" plain label={percent} onPress={() => press($, 'ui.press', () => openOn($, 'rules'))} />
      <Box gap={2} flexGrow={1} flexShrink={1}>
        {items.map(item =>
          item.opens === null ? (
            <Text key={item.key} color={CLAY} wrap="truncate-end">
              {item.text}
            </Text>
          ) : (
            <Button key={item.key} plain dimColor label={item.text} onPress={() => press($, 'ui.press', () => openOn($, item.opens ?? 'rules'))} />
          ),
        )}
        {room >= CARD_MIN && cells.map(cell => card(els, cell.kind, cardText(cell.kind, tokens[cell.kind] ?? 0, rules), room))}
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------- hooks

export const register: Register = (on, options) => {
  threshold = typeof options.threshold === 'number' && options.threshold > 0 ? options.threshold : DEFAULT_THRESHOLD

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: COMMAND, description: 'Show what Claude carries and take pieces out' })
    } catch {
      await lose($, 'session.start')
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    isTurnRunning = true
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // A subagent's turn end is not the person's move, and its window is not the one the bar shows.
    if (e.agentId !== undefined) {
      return next(e)
    }
    isTurnRunning = false
    const done = await next(e)
    try {
      await refresh($)
      // A refresh that works again ends what a failed one recorded; another event's note stays.
      if ((await read($, lostAt)) === 'turn.complete') {
        await update($, lostAt, () => null)
      }
    } catch {
      await lose($, 'turn.complete')
    }

    return done
  })

  on('prompt.context', async ($, e, next) => {
    const core = await next(e)
    try {
      const inForce = (await read($, applied)).filter(f => f.source !== MEMORY)
      const rules = await read($, sessionRules)
      if (e.instructionFiles !== undefined) {
        lastFiles = e.instructionFiles
      }
      if (inForce.length === 0 && rules.length === 0) {
        return core
      }
      let blocks: PromptContextBlock[] = [...core.blocks]
      if (inForce.length > 0) {
        if (e.instructionFiles === undefined) {
          await lose($, 'prompt.context (claudeMd rewritten above headspace)')
        } else {
          const files = e.instructionFiles
          const rewritten: PromptContextBlock[] = []
          for (const block of blocks) {
            rewritten.push(block.name === 'claudeMd' ? await rewriteClaudeMd($, block, files) : block)
          }
          blocks = rewritten
        }
      }
      if (rules.length > 0) {
        const text = 'Session rules the person set for this session:\n' + rules.map(r => '- ' + r).join('\n')
        blocks = [...blocks.filter(b => b.name !== SESSION_RULES), { name: SESSION_RULES, text }]
      }

      return { ...core, blocks }
    } catch {
      await lose($, 'prompt.context')

      return core
    }
  })

  on('prompt.section', { name: 'memory' }, async ($, e, next) => {
    const core = await next(e)
    try {
      if (core.text === null) {
        return core
      }
      lastMemory = core.text
      const changes = (await read($, applied)).find(f => f.source === MEMORY)?.changes ?? {}
      const off = new Set(Object.entries(changes).filter(([, list]) => list.some(c => c.type === 'off')).map(([id]) => id))
      if (off.size === 0) {
        return core
      }

      return { text: renderMemory(core.text, off) }
    } catch {
      await lose($, 'prompt.section')

      return core
    }
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const verb = e.args.trim()
    try {
      if (verb === 'apply') {
        const count = await applyRules($)

        return { text: count === 0 ? 'headspace: nothing to apply' : `headspace: applied, from the next request` }
      }
      if (verb === 'cut') {
        const refusal = await cutRefusal($)
        if (refusal !== null) {
          return { text: `headspace: ${refusal}` }
        }
        const count = (await read($, marks)).length
        // A compaction cannot start under the turn this hook holds: it starts once the command is answered.
        $.clock.after(0, () => void applyCut($))

        return { text: `removing ${count} ${count === 1 ? 'result' : 'results'}` }
      }
      const kind = verb === '' ? 'rules' : verb
      if (!isKind(kind)) {
        return { text: 'headspace: /headspace [rules|large|system|conversation|free|reserve|apply|cut]' }
      }
      await openOn($, kind)

      return { text: '' }
    } catch {
      await lose($, `/headspace ${verb}`.trimEnd())

      return { text: 'headspace lost track at /headspace' }
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    let shot: HeadspaceSnapshot | null
    try {
      shot = await read($, snapshot)
    } catch {
      shot = null
    }
    if (shot === null || e.props.hasSurvey) {
      return next(e)
    }
    // One band for every plugin: emcc-core or witness may draw beneath, in the rows headspace's one row leaves.
    // What they draw is never swallowed.
    const below = await next({ ...e, props: { ...e.props, maxRows: Math.max(1, e.props.maxRows - 1) } })
    try {
      const row = await bandRow($, $.ui.resolve(e), shot, e.props.bodyColumns)
      if (isBlank(below)) {
        return row
      }
      const { Box } = $.ui.resolve(e)

      // headspace's row first, then the band beneath; a pair taller than maxRows scrolls in the band's window.
      return (
        <Box flexDirection="column">
          {row}
          {below}
        </Box>
      )
    } catch {
      // Writes are refused while drawing: the band beneath stands in, and the pane says the rest.
      return below
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Input = 'Input' in table ? table.Input : undefined
    const els = { Box, Text, Button }
    try {
      const kind = await read($, selected)
      const at = cursorOf(await read($, cursor))
      const lost = await read($, lostAt)
      const shot = await read($, snapshot)
      const tokens = shot?.segments.find(s => s.kind === kind)?.tokens ?? 0
      const columns = e.props.bodyColumns
      const body =
        kind === 'rules'
          ? await rulesBody($, els, Input, columns, at)
          : kind === 'large'
            ? await largeBody($, els, columns, at)
            : categoriesBody(els, kind, tokens)

      return (
        <Box flexDirection="column" gap={1}>
          {lost !== null && <Text color={CLAY}>{`headspace lost track at ${lost}`}</Text>}
          {tabs($, els, kind)}
          <Text bold color={COLOURS[kind]}>{`${kind}  ${formatTokens(tokens)}`}</Text>
          {body}
        </Box>
      )
    } catch {
      return <Text color={CLAY}>headspace lost track at ui.render</Text>
    }
  })
}
