import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

export type Session = {
  clock: MockClock
  opened: { id: string; title?: string; focus?: boolean; closeOnEscape?: boolean }[]
  isWide: boolean
  failing: Set<string>
  isCwdBroken: boolean
  /** Tools whose calls are denied (a hook or the person said no). */
  denying: Set<string>
  /** What a TaskCreate answers: the structured result, the text, or both. */
  taskAnswer: 'both' | 'structured' | 'text'
}

/**
 * The engine beneath witness: a repo at /repo, a clock that moves only when
 * the test moves it, a pane that is placed while `isWide`, task ids counted
 * from 1, and commands or file paths that fail while listed in `failing`.
 * A call given `holdMs` runs that long on the clock (start it unawaited and
 * advance the clock); a Bash call with `run_in_background` answers a
 * background task id; tools listed in `denying` are denied; a tool called
 * `Crash` throws.
 *
 * A test's own hooks may not read `$.state`, so reading witness's state (`state`)
 * and what `Peek` saw (`seen`) needs the `probe` plugin: `{ plugins: [probe] }`.
 */
export function session(on: On): Session {
  const it: Session = {
    clock: mock.clock(on, { now: 0 }),
    opened: [],
    isWide: true,
    failing: new Set(),
    isCwdBroken: false,
    denying: new Set(),
    taskAnswer: 'both',
  }
  let nextId = 1
  // Nothing in the test engine answers these two beneath the plugins.
  on('prompt.submit', (_$, e) => ({ text: (e as unknown as { text: string }).text }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.cwd', () => {
    if (it.isCwdBroken) {
      throw new Error('cwd is gone')
    }

    return { value: '/repo' }
  })
  on('ui.open', (_$, e) => {
    it.opened.push(e as unknown as Session['opened'][number])

    return { value: it.isWide ? { isPlaced: true } : { isPlaced: false, reason: 'too narrow' } } as never
  })
  on('tool.call', async (_$, e) => {
    const call = e as unknown as { tool: string; command?: string; subject?: string; taskId?: string; holdMs?: number; run_in_background?: boolean }
    if (call.holdMs !== undefined) {
      await it.clock.sleep(call.holdMs)
    }
    if (call.tool === 'Crash') {
      throw new Error('the tool crashed')
    }
    if (it.denying.has(call.tool)) {
      return { deny: `${call.tool} denied` } as never
    }
    if (call.tool === 'TaskCreate') {
      const id = String(nextId)
      nextId += 1
      const result = { task: { id, subject: call.subject ?? '' } }
      const text = `Task #${id} created successfully: ${call.subject ?? ''}`
      if (it.taskAnswer === 'structured') {
        return { result, text: '' } as never
      }

      return { result: it.taskAnswer === 'text' ? {} : result, text } as never
    }
    if (call.tool === 'Bash' && call.run_in_background === true) {
      return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg-1' }, text: 'Command running in background with ID: bg-1' } as never
    }
    if (call.tool === 'TaskUpdate') {
      return { result: { success: true, taskId: call.taskId ?? '', updatedFields: ['status'] }, text: `Updated task #${call.taskId ?? ''}` } as never
    }
    if (it.failing.has(call.command ?? (call as { file_path?: string }).file_path ?? '')) {
      return { isError: true, result: 'Exit code 1', text: 'Exit code 1\n1 failing' } as never
    }

    return { result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' } as never
  })

  return it
}

/** Moves the clock `ms` on, then makes the call: the call's segment lasts `ms`. */
export async function call($: Engine, it: Session, input: Record<string, unknown>, ms = 1000) {
  await it.clock.advance(ms)

  return $.tool.call(input as never)
}

/** A prompt; with no `origin`, the person typed it. */
export async function prompt($: Engine, text: string, extra: { origin?: { kind: string }; turnId?: string } = {}) {
  return $.prompt.submit({ text, ...extra } as never)
}

export async function command($: Engine, name: string, args = ''): Promise<string> {
  return (await $.command.run({ command: name, args } as never)).text ?? ''
}

/** What witness holds under `key`, as JSON: `null` when it holds nothing. Needs the `probe` plugin. */
export async function state($: Engine, key: string): Promise<any> {
  return JSON.parse(await command($, 'witness-state'))[key] ?? null
}

/** What witness held as `now` at each `Peek` call, in order. Needs the `probe` plugin. */
export async function seen($: Engine): Promise<unknown[]> {
  return JSON.parse(await command($, 'witness-seen'))
}

/** Ends Claude's turn (it answered, and it is the person's move), or a subagent's with `agentId`. */
export async function endTurn($: Engine, agentId?: string) {
  const ended = { answer: 'Done.', durationMs: 0, isAborted: false, turnId: 'turn-1', reason: 'answer' }

  return $.turn.complete((agentId === undefined ? ended : { ...ended, agentId }) as never)
}

/** Makes the call and holds it `ms` on the clock: the call itself lasts `ms`. */
export async function hold($: Engine, it: Session, input: Record<string, unknown>, ms: number) {
  const ran = $.tool.call({ ...input, holdMs: ms } as never)
  await it.clock.settle()
  await it.clock.advance(ms)

  return ran
}
