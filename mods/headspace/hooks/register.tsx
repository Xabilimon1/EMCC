import { atom, read, update } from 'claude-code'
import type { ApiMessage, EngineInterface, InstructionFile, PromptContextBlock, Register } from 'claude-code'

import type { HeadspaceFileChanges, HeadspaceKind, HeadspaceRuleChange } from '../types'
import { ORDER, toSegments } from './bar'
import type { Category } from './bar'
import { cutInstructions, label, largeResults } from './large'
import type { LargeResult } from './large'
import { renderMemory } from './memory'
import { parseRules, renderRules } from './rules'

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
 * the block, are dropped from applied and counted stale.
 */
async function rewriteClaudeMd($: EngineInterface, block: PromptContextBlock, files: readonly InstructionFile[]): Promise<PromptContextBlock> {
  const inForce = (await read($, applied)).filter(f => f.source !== MEMORY)
  let text = block.text
  let stale = 0
  const kept: HeadspaceFileChanges[] = []
  for (const entry of inForce) {
    const file = files.find(f => f.path === entry.source)
    if (file === undefined) {
      // Not loaded in this context (a nested file not read yet): kept for when it is.
      kept.push(entry)
      continue
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
  if (stale > 0) {
    const memory = (await read($, applied)).filter(f => f.source === MEMORY)
    await update($, applied, () => [...kept, ...memory])
    await update($, staleCount, count => count + stale)
  }

  return text === block.text ? block : { name: block.name, text }
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
    cutNotice = refusal

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
          cutNotice = refusal

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
}
