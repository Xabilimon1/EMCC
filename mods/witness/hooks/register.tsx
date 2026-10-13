import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { WitnessPhase, WitnessSegment, WitnessStep } from '../types'
import { collapsed, goalFromPrompt, parseGoal } from './goal'
import { criterionMarkOf, markOf } from './marks'
import type { Check, Flag } from './marks'
import { addedTotal, appended, phaseOf } from './phases'

const PANE = 'witness'
const KEEP_EDITS = 500
const KEEP_RUNS = 100
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
/** The calls after which a mark can change, so the badge is worth redrawing. */
const MARKING_TOOLS = new Set([...EDIT_TOOLS, 'Bash', 'TaskCreate', 'TaskUpdate'])
/** Where a prompt the person sent comes from; anything else (a notification, a peer, a schedule) is not their goal. */
const PERSON_ORIGINS = new Set(['composer', 'bridge', 'sdk'])

// Anthropic's palette, one colour per phase (the pane draws with them).
const SKY = '#6a9bcc'
const OLIVE = '#788c5d'
const CLAY = '#d97757'
const LIGHT = '#e8e6dc'
const STONE = '#b0aea5'
const PHASES: readonly WitnessPhase[] = ['explore', 'implement', 'debug', 'verify', 'waiting']
const PHASE_COLOR: Record<WitnessPhase, string> = { explore: SKY, implement: OLIVE, debug: CLAY, verify: LIGHT, waiting: STONE }

// ---------------------------------------------------------------- state

const goal = atom({ plugin: 'witness', key: 'goal' } as const, '')
const promptGoal = atom({ plugin: 'witness', key: 'promptGoal' } as const, '')
const isGoalSet = atom({ plugin: 'witness', key: 'isGoalSet' } as const, false)
const goalSetAt = atom({ plugin: 'witness', key: 'goalSetAt' } as const, null)
const criteria = atom({ plugin: 'witness', key: 'criteria' } as const, [])
const steps = atom({ plugin: 'witness', key: 'steps' } as const, [])
const edits = atom({ plugin: 'witness', key: 'edits' } as const, [])
const runs = atom({ plugin: 'witness', key: 'runs' } as const, [])
const segments = atom({ plugin: 'witness', key: 'segments' } as const, [])
const totals = atom({ plugin: 'witness', key: 'totals' } as const, {})
const cursor = atom({ plugin: 'witness', key: 'cursor' } as const, null)
const waitingSince = atom({ plugin: 'witness', key: 'waitingSince' } as const, null)
const isDebugging = atom({ plugin: 'witness', key: 'isDebugging' } as const, false)
const now = atom({ plugin: 'witness', key: 'now' } as const, null)
const beat = atom({ plugin: 'witness', key: 'beat' } as const, false)
const hasOpened = atom({ plugin: 'witness', key: 'hasOpened' } as const, false)
const isPlaced = atom({ plugin: 'witness', key: 'isPlaced' } as const, false)
const isPaused = atom({ plugin: 'witness', key: 'isPaused' } as const, false)
const lostAt = atom({ plugin: 'witness', key: 'lostAt' } as const, null)

/** A tool call's input, as much of it as witness reads. */
type ToolCall = {
  tool: string
  command?: string
  file_path?: string
  notebook_path?: string
  old_string?: string
  new_string?: string
  subject?: string
  taskId?: string
  status?: string
}

/** A tool call's result, as much of it as witness reads. */
type Ran = { deny?: string; isError?: boolean; text?: string; result?: unknown }

let beatTimer: Timer | null = null
/** Tool calls started and not yet finished: Now and the beat end with the last. */
let inFlight = 0
/** The ribbon's reads and writes, one stretch at a time, so calls in parallel never share a cursor. */
let queue: Promise<unknown> = Promise.resolve()
/** The badge last written, so the same one is not written again after every call. */
let lastBadge = ''
/** Counts the queue's steps; each writes it, see `queued`. */
let ticks = 0

function serially<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work)
  queue = run.catch(() => undefined)

  return run
}

/**
 * Queues `work` without waiting for it: a hook hands its event on at once, and
 * a failure in the work is recorded as `lostAt`. witness never holds a tool
 * call, a prompt or a turn end on its own bookkeeping.
 */
function queued($: EngineInterface, where: string, work: () => Promise<void>): void {
  serially(async () => {
    // A dispatch's reads are pinned to one moment until it writes, and this
    // step may run long after its hook began: writing first makes its reads
    // see what the steps before it wrote.
    ticks += 1
    await $.state.set({ plugin: 'witness', key: 'queueTick' }, ticks)
    await work()
  }).catch(() => lose($, where))
}

/** The time now, asked at once and awaited later in the queue; a failure surfaces where it is awaited. */
function timeNow($: EngineInterface): Promise<number> {
  const asked = $.clock.now()
  asked.catch(() => undefined)

  return asked
}

async function lose($: EngineInterface, where: string): Promise<void> {
  try {
    await update($, lostAt, () => where)
  } catch {
    // Nothing left to record with.
  }
}

/** Whether witness is watching; a state it cannot read counts as paused, so the call goes on untouched. */
async function isWatching($: EngineInterface, where: string): Promise<boolean> {
  try {
    return !(await read($, isPaused))
  } catch {
    await lose($, where)

    return false
  }
}

// ---------------------------------------------------------------- labels

function relative(path: string, cwd: string): string {
  return cwd !== '' && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path
}

function lineCount(text: string | undefined): number {
  return text === undefined || text === '' ? 0 : text.replace(/\n$/, '').split('\n').length
}

/** What Now says of a call; `cwd` is '' when the engine could not tell it, and paths then show whole. */
function labelOf(call: ToolCall, cwd: string): string {
  const file = call.file_path ?? call.notebook_path
  if (call.tool === 'Edit' && file !== undefined) {
    return `edits ${relative(file, cwd)} +${lineCount(call.new_string)} −${lineCount(call.old_string)}`
  }
  if (call.tool === 'Write' && file !== undefined) {
    return `writes ${relative(file, cwd)}`
  }
  if (call.tool === 'Read' && file !== undefined) {
    return `reads ${relative(file, cwd)}`
  }
  if (call.tool === 'Bash' && call.command !== undefined) {
    const shown = collapsed(call.command)

    return `runs ${shown.length > 60 ? `${shown.slice(0, 59)}…` : shown}`
  }
  if (call.tool === 'TaskCreate' || call.tool === 'TaskUpdate') {
    return 'plans'
  }

  return `uses ${call.tool}`
}

// ---------------------------------------------------------------- emcc-core

/** emcc-core's checks and flags, or null when it is not installed. */
async function emccFacts($: EngineInterface): Promise<{ checks: Check[]; flags: Flag[] } | null> {
  try {
    const evidence = await $.emcc.evidenceSince({ at: 0 })
    const flags = await $.emcc.flagsSince({ at: 0 })

    return { checks: evidence.filter(item => item.kind !== 'edit'), flags }
  } catch {
    return null
  }
}

async function isCheck($: EngineInterface, command: string): Promise<boolean> {
  try {
    return (await $.emcc.kindsOf({ command })).length > 0
  } catch {
    return false
  }
}

async function hasEmcc($: EngineInterface): Promise<boolean> {
  try {
    await $.emcc.profile()

    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- proof, badge and pane

type Counted = { proven: number; total: number }

async function provenCount($: EngineInterface): Promise<Counted> {
  const facts = await emccFacts($)
  const editList = await read($, edits)
  const runList = await read($, runs)
  const stepMarks = (await read($, steps)).map(step => markOf(step, editList, facts?.checks ?? null, facts?.flags ?? null))
  // A criterion answers only for the flags raised since /goal set it.
  const setAt = (await read($, goalSetAt)) ?? 0
  const criterionFlags = facts === null ? null : facts.flags.filter(flag => flag.at >= setAt)
  const criterionMarks = (await read($, criteria)).map(one => criterionMarkOf(one, runList, editList, criterionFlags))
  const proven =
    stepMarks.filter(mark => mark.kind === 'proven').length +
    criterionMarks.filter(mark => mark.kind === 'proven' || mark.kind === 'ticked').length

  return { proven, total: stepMarks.length + criterionMarks.length }
}

async function summaryText($: EngineInterface): Promise<string> {
  const counted = await provenCount($)

  return `Goal: ${(await read($, goal)) || 'none yet'}\n${counted.proven}/${counted.total} proven`
}

/** The EMCC badge: cleared while the pane is placed, the count while it is not; written only when it changed. */
async function refreshBadge($: EngineInterface): Promise<void> {
  try {
    if (!(await hasEmcc($))) {
      // Without emcc-core the line above the prompt is witness's own.
      return
    }
    let badge: { id: string; text?: string; tone?: 'good' | 'neutral' } = { id: 'witness' }
    if (!(await read($, isPlaced))) {
      const counted = await provenCount($)
      badge = {
        id: 'witness',
        text: `witness ${counted.proven}/${counted.total} proven, /live`,
        tone: counted.total > 0 && counted.proven === counted.total ? 'good' : 'neutral',
      }
    }
    const written = JSON.stringify(badge)
    if (written === lastBadge) {
      return
    }
    await $.emcc.badge(badge)
    lastBadge = written
  } catch {
    // The badge is a convenience; the pane and /live still answer.
  }
}

async function openPane($: EngineInterface, isAsked: boolean): Promise<boolean> {
  const opened = await $.ui.open(isAsked ? { id: PANE, title: 'witness', focus: true, closeOnEscape: true } : { id: PANE, title: 'witness', closeOnEscape: true })
  await update($, isPlaced, () => opened.isPlaced)

  return opened.isPlaced
}

function startBeat($: EngineInterface): void {
  if (beatTimer !== null) {
    return
  }
  beatTimer = $.clock.every(1000, () => {
    void update($, beat, value => !value)
  })
}

function endBeat(): void {
  beatTimer?.cancel()
  beatTimer = null
}

// ---------------------------------------------------------------- the ribbon

/** The phase in progress for a call that has none: the last work done, never the waiting. */
function workPhase(list: readonly WitnessSegment[]): WitnessPhase {
  return list.findLast(one => one.phase !== 'waiting')?.phase ?? 'explore'
}

/** Adds a finished stretch to the ribbon and to the running totals, which always move together. */
async function addStretch($: EngineInterface, phase: WitnessPhase, start: number, end: number): Promise<void> {
  if (end <= start) {
    return
  }
  await update($, segments, list => appended(list, phase, start, end))
  await update($, totals, sums => addedTotal(sums, phase, end - start))
}

/**
 * Ends the person's move at `at`: the waiting so far goes to the ribbon, and
 * work is counted from here. A call sent to the background that closes the
 * waiting counts its wait as work; witness accepts that small undercount.
 */
async function closeWaiting($: EngineInterface, at: number): Promise<void> {
  const since = await read($, waitingSince)
  if (since !== null) {
    await addStretch($, 'waiting', since, at)
    await update($, waitingSince, () => null)
    await update($, cursor, () => at)
  }
}

/**
 * Pauses watching at once: Now and the beat stop now, and steps already queued
 * find witness paused and record nothing. The waiting so far is kept, closed in
 * the queue at the pause's time. `/live pause` and the pane's `p` both come here.
 */
async function pause($: EngineInterface): Promise<void> {
  endBeat()
  const at = timeNow($)
  await update($, isPaused, () => true)
  await update($, now, () => null)
  queued($, 'command.run', async () => closeWaiting($, await at))
}

/**
 * Watches again, in the queue, so that nothing queued while paused is recorded;
 * the ribbon picks up from the resume, so paused time belongs to no phase.
 * Nothing opens a waiting stretch while paused (pause closed the open one), so
 * there is none to clear. Resumed during the person's move, the rest of that
 * move is counted as work by the next call; witness accepts that undercount.
 */
function resume($: EngineInterface): void {
  const at = timeNow($)
  queued($, 'command.run', async () => {
    const resumedAt = await at
    await update($, cursor, () => resumedAt)
    await update($, isPaused, () => false)
  })
}

// ---------------------------------------------------------------- tool calls

/** Before the call runs, in the queue: the waiting ends and the cursor is set first, before anything that can fail. */
async function before($: EngineInterface, call: ToolCall, at: number): Promise<void> {
  if (await read($, isPaused)) {
    return
  }
  await closeWaiting($, at)
  if ((await read($, cursor)) === null) {
    await update($, cursor, () => at)
  }
  let cwd = ''
  try {
    cwd = await $.session.cwd()
  } catch {
    // The label shows the whole path.
  }
  await update($, now, () => ({ label: labelOf(call, cwd), since: at }))
  startBeat($)
  if (!(await read($, hasOpened))) {
    await update($, hasOpened, () => true)
    await openPane($, false)
  }
}

/** The in-progress step an edit belongs to: the one that went in progress last (a reopened step counts from its reopening). */
function activeStep(list: readonly WitnessStep[]): WitnessStep | undefined {
  return list
    .filter(one => one.status === 'in_progress' && one.id !== null)
    .reduce<WitnessStep | undefined>(
      (best, one) => (best === undefined || (one.lastStartedAt ?? 0) > (best.lastStartedAt ?? 0) ? one : best),
      undefined,
    )
}

/** After the call ran: queued, never awaited by the call. */
function after($: EngineInterface, call: ToolCall, ran: Ran): void {
  // The beat and Now end with the last call in flight, before anything that can fail.
  inFlight = Math.max(0, inFlight - 1)
  if (inFlight === 0) {
    endBeat()
  }
  // When the call ended, asked now: a call recorded late still ends where it ended.
  const endedAt = timeNow($)
  queued($, 'tool.call', async () => {
    const at = await endedAt
    if (inFlight === 0) {
      await update($, now, () => null)
    }
    if (await read($, isPaused)) {
      return
    }
    const isDenied = ran.deny !== undefined
    const isFailed = ran.isError === true
    const isBackground = !isDenied && !isFailed && (ran.result as { backgroundTaskId?: unknown } | undefined)?.backgroundTaskId !== undefined
    // A denied or backgrounded command has no outcome yet: it is no check, and debugging does not change.
    const checked = !isDenied && !isBackground && call.tool === 'Bash' && call.command !== undefined && (await isCheck($, call.command))
    const step = phaseOf({ tool: call.tool, command: call.command, isCheck: checked, isError: isFailed }, await read($, isDebugging))
    await update($, isDebugging, () => step.isDebugging)
    // Even a denied call took its time, in its phase.
    const phase = step.phase ?? workPhase(await read($, segments))
    await addStretch($, phase, (await read($, cursor)) ?? at, at)
    await update($, cursor, () => at)
    // The main turn may have ended while this call ran: the person's move starts when the call ended, not before.
    const since = await read($, waitingSince)
    if (since !== null && since < at) {
      await update($, waitingSince, () => at)
    }
    if (isDenied) {
      return
    }

    const file = call.file_path ?? call.notebook_path
    if (EDIT_TOOLS.has(call.tool) && file !== undefined && !isFailed) {
      const active = activeStep(await read($, steps))
      await update($, edits, list => [...list, { file, at, stepId: active?.id ?? null }].slice(-KEEP_EDITS))
      if (active !== undefined) {
        await update($, steps, list =>
          list.map(one => (one.id === active.id && !one.files.includes(file) ? { ...one, files: [...one.files, file] } : one)),
        )
      }
    }
    if (call.tool === 'Bash' && call.command !== undefined && !isBackground) {
      const command = collapsed(call.command)
      await update($, runs, list => [...list, { command, at, isOk: !isFailed }].slice(-KEEP_RUNS))
    }
    if (call.tool === 'TaskCreate' && !isFailed) {
      const structured = (ran.result as { task?: { id?: unknown } } | undefined)?.task?.id
      const id = typeof structured === 'string' ? structured : (/Task #(\S+) created/.exec(ran.text ?? '')?.[1] ?? null)
      const added: WitnessStep = {
        id,
        subject: call.subject ?? '',
        status: 'pending',
        createdAt: at,
        startedAt: null,
        lastStartedAt: null,
        completedAt: null,
        files: [],
      }
      await update($, steps, list => [...list, added])
    }
    if (call.tool === 'TaskUpdate' && !isFailed && call.taskId !== undefined) {
      const id = call.taskId
      await update($, steps, list =>
        list.flatMap(one => {
          if (one.id !== id) {
            return [one]
          }
          if (call.status === 'deleted') {
            return []
          }
          const status = call.status === 'pending' || call.status === 'in_progress' || call.status === 'completed' ? call.status : one.status

          return [
            {
              ...one,
              subject: call.subject ?? one.subject,
              status,
              startedAt: status === 'in_progress' && one.startedAt === null ? at : one.startedAt,
              lastStartedAt: status === 'in_progress' && one.status !== 'in_progress' ? at : one.lastStartedAt,
              completedAt: status === 'completed' ? (one.completedAt ?? at) : null,
            },
          ]
        }),
      )
    }
    if (MARKING_TOOLS.has(call.tool)) {
      await refreshBadge($)
    }
  })
}

// ---------------------------------------------------------------- register

/** `/goal`: sets the goal and its criteria, or clears them; answers what it did. */
async function setGoal($: EngineInterface, text: string): Promise<string> {
  if (text === '') {
    const fallback = await read($, promptGoal)
    await update($, goal, () => fallback)
    await update($, isGoalSet, () => false)
    await update($, goalSetAt, () => null)
    await update($, criteria, () => [])

    return 'Goal cleared; it follows your prompt again.'
  }
  const parsed = parseGoal(text)
  const count = parsed.criteria.length
  const at = await $.clock.now()
  await update($, criteria, () => parsed.criteria)
  await update($, goalSetAt, () => at)
  if (parsed.goal === '') {
    // Only criteria: the goal keeps following the prompt.
    const fallback = await read($, promptGoal)
    await update($, goal, () => fallback)
    await update($, isGoalSet, () => false)

    return `${countText(count)} set; the goal follows your prompt.`
  }
  await update($, goal, () => parsed.goal)
  await update($, isGoalSet, () => true)

  return count === 0 ? 'Goal set.' : `Goal set with ${countText(count)}.`
}

function countText(count: number): string {
  return `${count} ${count === 1 ? 'criterion' : 'criteria'}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'live', description: 'witness: open the live view; "pause" stops watching, "resume" starts again' })
      await $.command.register({ name: 'goal', description: 'witness: set the goal, with criteria after "done when"; empty clears it' })
    } catch {
      await lose($, 'session.start')
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const at = timeNow($)
    queued($, 'prompt.submit', async () => {
      if (await read($, isPaused)) {
        return
      }
      const isSlash = e.text.trimStart().startsWith('/')
      // A prompt delivered into a running turn, or a slash command, starts no work: the waiting stays open.
      if (e.turnId === undefined && !isSlash) {
        const submittedAt = await at
        await closeWaiting($, submittedAt)
        await update($, cursor, () => submittedAt)
      }
      const kind = (e.origin as { kind: string } | undefined)?.kind
      if (!isSlash && (kind === undefined || PERSON_ORIGINS.has(kind))) {
        const fromPrompt = goalFromPrompt(e.text)
        await update($, promptGoal, () => fromPrompt)
        if (!(await read($, isGoalSet))) {
          await update($, goal, () => fromPrompt)
        }
      }
    })

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (!(await isWatching($, 'tool.call'))) {
      return next(e)
    }
    const call = e as unknown as ToolCall
    inFlight += 1
    // Queued, never awaited: the call goes on at once, and the queue still runs this before the call's own after.
    const startedAt = timeNow($)
    queued($, 'tool.call', async () => before($, call, await startedAt))
    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } catch (error) {
      // The call itself threw: its time was spent, nothing else is recorded, and the error goes on as it was.
      after($, call, { deny: 'the call threw' })
      throw error
    }
    after($, call, ran as unknown as Ran)

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    // A subagent's turn ending is not the person's move; its tool calls still count as Claude's work.
    if (e.agentId !== undefined) {
      return next(e)
    }
    if (inFlight === 0) {
      endBeat()
    }
    const at = timeNow($)
    queued($, 'turn.complete', async () => {
      if (await read($, isPaused)) {
        return
      }
      if (inFlight === 0) {
        await update($, now, () => null)
      }
      if ((await read($, waitingSince)) !== null) {
        return
      }
      // The turn's last stretch runs to its end, in the phase of the work before it; then the person's move.
      const endedAt = await at
      const from = await read($, cursor)
      if (from !== null) {
        await addStretch($, workPhase(await read($, segments)), from, endedAt)
      }
      await update($, cursor, () => endedAt)
      await update($, waitingSince, () => endedAt)
    })

    return next(e)
  })

  on('command.run', { command: 'live' }, async ($, e) => {
    try {
      const verb = e.args.trim()
      if (verb === 'pause') {
        await pause($)

        return { text: 'witness paused for this session.' }
      }
      if (verb === 'resume') {
        resume($)

        return { text: 'witness is watching again.' }
      }
      const placed = await openPane($, true)
      queued($, 'command.run', async () => refreshBadge($))

      return { text: placed ? 'witness opened.' : await summaryText($) }
    } catch {
      await lose($, 'command.run')

      return { text: 'witness lost track at /live.' }
    }
  })

  on('command.run', { command: 'goal' }, async ($, e) => {
    try {
      const answer = await setGoal($, e.args.trim())
      queued($, 'command.run', async () => refreshBadge($))

      return { text: answer }
    } catch {
      await lose($, 'command.run')

      return { text: 'witness lost track at /goal.' }
    }
  })
}
