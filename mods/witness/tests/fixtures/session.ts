import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

export type Session = {
  clock: MockClock
  opened: { id: string; title?: string; focus?: boolean; closeOnEscape?: boolean }[]
  isWide: boolean
  failing: Set<string>
  isCwdBroken: boolean
}

/**
 * The engine beneath witness: a repo at /repo, a clock that moves only when
 * the test moves it, a pane that is placed while `isWide`, task ids counted
 * from 1, and commands or file paths that fail while listed in `failing`.
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
  }
  let nextId = 1
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
    const call = e as unknown as { tool: string; command?: string; subject?: string; taskId?: string }
    if (call.tool === 'TaskCreate') {
      const id = String(nextId)
      nextId += 1

      return { result: { task: { id, subject: call.subject ?? '' } }, text: `Task #${id} created successfully: ${call.subject ?? ''}` } as never
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

export async function prompt($: Engine, text: string) {
  return $.prompt.submit({ text } as never)
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
