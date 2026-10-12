import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

export const SPEC = "it('adds', () => {\n  expect(add(1, 2)).toBe(3)\n  expect(add(0, 0)).toBe(0)\n})\n"
export const WEAKER = { file_path: '/repo/src/add.test.ts', old_string: '  expect(add(0, 0)).toBe(0)\n', new_string: '' }

export type World = {
  asked: string[]
  ran: string[]
  files: Map<string, string>
  answer: string | null
  surfaces: string[]
  isReadBroken: boolean
  isBashFailing: boolean
}

/** What a refused call tells Claude. */
export function said(out: { deny?: string; text?: string }): string {
  return out.deny ?? out.text ?? ''
}

/**
 * The engine beneath the mod: a repo at /repo, a dialog that answers
 * `world.answer` (or is dismissed when null), and tools that record what ran.
 */
export function world(
  on: On,
  files: Record<string, string> = { '/repo/src/add.test.ts': SPEC },
  stored: Record<string, unknown> = {},
): World {
  const it: World = {
    asked: [],
    ran: [],
    files: new Map(Object.entries(files)),
    answer: 'Allow once',
    surfaces: ['terminal'],
    isReadBroken: false,
    isBashFailing: false,
  }
  mock.clock(on, { now: 5000 })
  mock.store(on, stored)
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.surfaces', () => ({ value: it.surfaces }) as never)
  on('fs.exists', (_$, e) => ({ value: it.files.has((e as { path: string }).path) }))
  on('fs.read', (_$, e) => {
    if (it.isReadBroken) {
      throw new Error('EACCES: permission denied')
    }
    const text = it.files.get((e as { path: string }).path)
    if (text === undefined) {
      throw new Error('ENOENT')
    }

    return { value: text }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const [question] = (e as unknown as { questions: { question: string }[] }).questions
    it.asked.push(question?.question ?? '')
    if (it.answer === null) {
      return { isError: true, result: 'dismissed', text: 'The user dismissed the question' } as never
    }

    return { result: { questions: [question], answers: { [question?.question ?? '']: it.answer } } } as never
  })
  on('tool.call', (_$, e) => {
    const call = e as unknown as { tool: string; command?: string; file_path?: string }
    it.ran.push(call.command ?? `${call.tool} ${call.file_path ?? ''}`.trim())
    if (it.isBashFailing && call.tool === 'Bash') {
      return { isError: true, result: 'Exit code 1', text: 'Exit code 1' } as never
    }

    return { result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' } as never
  })

  return it
}

export async function edit($: Engine, input = WEAKER) {
  return $.tool.call({ tool: 'Edit', ...input } as never)
}

export async function bash($: Engine, command: string) {
  return $.tool.call({ tool: 'Bash', command } as never)
}

export async function goalposts($: Engine, args = ''): Promise<string> {
  return (await $.command.run({ command: 'goalposts', args } as never)).text ?? ''
}
