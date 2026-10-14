import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { stubText } from '../hooks/cut'
import { probe } from './fixtures/probe'

const WITH_PROBE = { plugins: [probe] }
const LABEL = 'Read a.json (9.8k tokens)'
const CUT = 'headspace-cut:{"marks":[{"id":"t1","label":"Read a.json (9.8k tokens)"}]}'
const SUMMARY = { role: 'user', text: 'Summary of the conversation.', toolUses: [] }

/** The transcript a compaction runs over, each message with the engine's handle. */
function transcript() {
  return [
    { role: 'user', text: 'Read a.json.', toolUses: [], handle: 'h1' },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 't1', tool: 'Read', input: { file_path: '/repo/a.json' } }], handle: 'h2' },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: 'x'.repeat(40000), isError: false }], handle: 'h3' },
    { role: 'assistant', text: 'It holds the data.', toolUses: [], handle: 'h4' },
  ]
}

/** Core beneath headspace-cut: it summarizes, and records what it was given. */
function core(on: On) {
  const ran: { instructions?: string; trigger: string }[] = []
  on('session.compact', (_$, e) => {
    ran.push({ instructions: e.instructions, trigger: e.trigger })

    return { messages: [SUMMARY] } as never
  })

  return ran
}

function compact($: Engine, trigger: string, instructions: string | undefined, messages: unknown[] = transcript()) {
  return $.session.compact({ trigger, instructions, messages } as never)
}

describe('answering a compaction', () => {
  for (const trigger of ['plugin', 'manual']) {
    test(`a ${trigger} compaction with headspace-cut instructions stubs the marked result and core never runs`, async ($, on) => {
      const ran = core(on)
      const before = transcript()
      const result = await compact($, trigger, CUT, before)
      expect(ran).toEqual([])
      expect(result.skip).toBeUndefined()
      const messages = result.messages ?? []
      expect(messages.length).toBe(4)
      expect(messages[0]).toEqual(before[0])
      expect(messages[2]?.handle).toBeUndefined()
      expect(messages[2]?.toolResults).toEqual([{ tool_use_id: 't1', text: stubText(LABEL), isError: false }])
      expect(messages[3]?.handle).toBe('h4')
    })
  }

  test('a compaction with other instructions reaches core untouched', async ($, on) => {
    const ran = core(on)
    expect(await compact($, 'manual', 'keep the plan')).toEqual({ messages: [SUMMARY] })
    expect(await compact($, 'plugin', undefined)).toEqual({ messages: [SUMMARY] })
    expect(ran).toEqual([
      { instructions: 'keep the plan', trigger: 'manual' },
      { instructions: undefined, trigger: 'plugin' },
    ])
  })

  test('headspace-cut instructions on an automatic compaction reach core untouched', async ($, on) => {
    const ran = core(on)
    expect(await compact($, 'auto', CUT)).toEqual({ messages: [SUMMARY] })
    expect(ran).toEqual([{ instructions: CUT, trigger: 'auto' }])
  })

  test('a marked id no message holds answers a skip, and core never runs', async ($, on) => {
    const ran = core(on)
    const result = await compact($, 'plugin', 'headspace-cut:{"marks":[{"id":"gone","label":"Bash ls (3k tokens)"}]}')
    expect(result.messages).toBeUndefined()
    expect(result.skip).toBe('headspace-cut: 1 marked result is no longer in the conversation')
    expect(ran).toEqual([])
  })

  test('headspace-cut instructions that mark nothing answer a skip, never a compaction that changes nothing', async ($, on) => {
    const ran = core(on)
    for (const trigger of ['plugin', 'manual']) {
      const result = await compact($, trigger, 'headspace-cut:{"marks":[]}')
      expect(result.messages).toBeUndefined()
      expect(result.skip).toBe('headspace-cut: nothing marked')
    }
    expect(ran).toEqual([])
  })

  test('headspace-cut instructions that do not parse answer a skip, never a summary', async ($, on) => {
    const ran = core(on)
    for (const trigger of ['plugin', 'manual']) {
      const result = await compact($, trigger, '  headspace-cut:{"marks":[{"id":"t1"}]}')
      expect(result.messages).toBeUndefined()
      expect(result.skip).toBe('headspace-cut: the instructions after headspace-cut: do not parse')
    }
    expect(ran).toEqual([])
  })

  test('a transcript it cannot read answers a skip, and core never runs', async ($, on) => {
    const ran = core(on)
    const broken = [{ role: 'user', text: '', toolUses: [], toolResults: 'not a list', handle: 'h1' }]
    const result = await compact($, 'plugin', CUT, broken)
    expect(result.messages).toBeUndefined()
    expect(result.skip?.startsWith('headspace-cut: ')).toBe(true)
    expect(ran).toEqual([])
  })
})

describe('session start and the heartbeat', () => {
  const state = async ($: Engine) => JSON.parse((await $.command.run({ command: 'headspace-cut-state', args: '' } as never)).text ?? '{}')

  test('writes ready and seenAt, so headspace knows it is there, and the session starts', WITH_PROBE, async ($, on) => {
    mock.clock(on, { now: 5000 })
    on('session.start', () => ({ cwd: '/repo' }) as never)
    expect(await state($)).toEqual({ ready: null, seenAt: null })
    expect(await $.session.start({ cwd: '/repo', surface: null, isInteractive: true } as never)).toEqual({ cwd: '/repo' })
    expect(await state($)).toEqual({ ready: true, seenAt: 5000 })
  })

  test('every main-loop turn end writes seenAt again; a subagent’s does not', WITH_PROBE, async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    on('turn.complete', () => ({ text: '' }) as never)
    const ended = { answer: 'Done.', durationMs: 10, isAborted: false, turnId: 'turn-1', reason: 'answer' }
    await clock.advance(7000)
    expect(await $.turn.complete(ended as never)).toEqual({ text: '' })
    expect((await state($)).seenAt).toBe(7000)
    await clock.advance(1000)
    await $.turn.complete({ ...ended, agentId: 'agent-1' } as never)
    expect((await state($)).seenAt).toBe(7000)
    await $.turn.complete(ended as never)
    expect((await state($)).seenAt).toBe(8000)
  })
})
