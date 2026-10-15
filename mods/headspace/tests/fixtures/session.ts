import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

/** A breakdown category as the engine stamps it. */
export type Row = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }

export type Session = {
  clock: MockClock
  /** The breakdown's rows; null when the session has no breakdown (a `-p` run). */
  categories: Row[] | null
  /** The breakdown's window (`rawMaxTokens`) and percentage. */
  window: number
  percent: number
  /** The last response's input tokens (the status line's figure); undefined until a response, or just after a compaction. */
  tokens?: number
  /** The live conversation, as `$.session.messages({ as: 'api' })` answers it. */
  api: unknown[]
  /** How many times the breakdown was asked for. */
  usageCalls: number
  /** What a compaction answers: `{ messages }` (it stood), or `{ skip }`. */
  compactAnswer: { messages: unknown[] } | { skip: string }
  /** The instructions of every compaction that reached the engine beneath headspace. */
  compactions: (string | undefined)[]
  opened: { id: string; title?: string; focus?: boolean; closeOnEscape?: boolean }[]
  toasts: string[]
  /** False: a pane opened now waits undrawn, as on a terminal too narrow to seat it. */
  isWide: boolean
  invalidated: string[]
  /** The commands registered, as given. */
  registered: unknown[]
}

let current: Session | null = null

async function settled(): Promise<void> {
  await current?.clock.settle()
}

/**
 * The engine beneath headspace: a repo at /repo, a clock that moves only when
 * the test moves it, a breakdown and a live conversation the test sets, and a
 * compaction that records its instructions and answers `compactAnswer`.
 * Core's `prompt.context` and `prompt.section` hand back what they are given.
 *
 * A test's own hooks may not read `$.state`, so reading headspace's state
 * (`state`) needs the `probe` plugin: `{ plugins: [probe] }`.
 */
export function session(on: On): Session {
  const it: Session = {
    clock: mock.clock(on, { now: 0 }),
    categories: [],
    window: 200_000,
    percent: 0,
    api: [],
    usageCalls: 0,
    compactAnswer: { messages: [{ role: 'user', text: 'what stood', toolUses: [] }] },
    compactions: [],
    opened: [],
    toasts: [],
    isWide: true,
    invalidated: [],
    registered: [],
  }
  current = it
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    it.registered.push(e)

    return { value: {} } as never
  })
  on('turn.start', (_$, e) => ({ turnId: (e as unknown as { turnId: string }).turnId }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.cwd', () => ({ value: '/repo' }) as never)
  on('session.usage', () => {
    it.usageCalls += 1
    const live = it.tokens === undefined ? {} : { tokens: it.tokens, percent: Math.round((it.tokens / it.window) * 100) }
    const context =
      it.categories === null
        ? { window: it.window, ...live }
        : {
            window: it.window,
            ...live,
            breakdown: {
              categories: it.categories.map(c => ({ ...c, color: 'inactive', isDeferred: c.kind === 'deferred' })),
              totalTokens: it.categories.filter(c => c.kind === 'used').reduce((sum, c) => sum + c.tokens, 0),
              maxTokens: it.window,
              rawMaxTokens: it.window,
              percentage: it.percent,
            },
          }

    return { value: { startedAt: 0, context, rateLimits: [] } } as never
  })
  on('session.messages', () => ({ value: it.api }) as never)
  on('session.compact', (_$, e) => {
    it.compactions.push((e as unknown as { instructions?: string }).instructions)

    return it.compactAnswer as never
  })
  on('prompt.context', (_$, e) => ({ blocks: e.blocks }) as never)
  on('prompt.section', (_$, e) => ({ text: e.text }) as never)
  on('ui.open', (_$, e) => {
    it.opened.push(e as unknown as Session['opened'][number])

    return { value: it.isWide ? { isPlaced: true } : { isPlaced: false, reason: 'the terminal is 80 columns; a pane the person opened needs 110' } } as never
  })
  on('ui.toast', (_$, e) => {
    it.toasts.push((e as unknown as { text: string }).text)

    return { value: undefined } as never
  })
  on('ui.invalidate', (_$, e) => {
    it.invalidated.push((e as unknown as { event: string }).event)

    return { value: undefined } as never
  })

  return it
}

export async function command($: Engine, name: string, args = ''): Promise<string> {
  await settled()
  const text = (await $.command.run({ command: name, args } as never)).text ?? ''
  await settled()

  return text
}

/** What headspace holds under `key`, as JSON: `null` when it holds nothing. Needs the `probe` plugin. */
export async function state($: Engine, key: string): Promise<any> {
  return JSON.parse(await command($, 'headspace-state'))[key] ?? null
}

/** Makes headspace read `value` for `key` until it writes the key itself. Needs the `probe` plugin. */
export async function seed($: Engine, key: string, value: unknown): Promise<void> {
  await command($, 'headspace-seed', `${key} ${JSON.stringify(value)}`)
}

/** Starts Claude's turn. */
export async function startTurn($: Engine) {
  await $.turn.start({ text: 'go', turnId: 'turn-1' } as never)
  await settled()
}

/** Ends Claude's turn (it answered, and it is the person's move), or a subagent's with `agentId`; the turn lasted `durationMs`. */
export async function endTurn($: Engine, agentId?: string, durationMs = 0) {
  const ended = { answer: 'Done.', durationMs, isAborted: false, turnId: 'turn-1', reason: 'answer' }
  const done = await $.turn.complete((agentId === undefined ? ended : { ...ended, agentId }) as never)
  await settled()

  return done
}
