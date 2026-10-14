import { describe, expect, test } from 'claude-code/testing'

import { CUT_PREFIX, cutMessages, parseCut, stubText } from '../hooks/cut'

const LABEL = 'Read a.json (9.8k tokens)'

type Result = { tool_use_id: string; text: string; isError: boolean; result?: unknown }
type Message = { role: 'user' | 'assistant'; text: string; toolUses: unknown[]; toolResults?: Result[]; handle?: string }

function conversation(): Message[] {
  return [
    { role: 'user', text: 'Read the data files.', toolUses: [], handle: 'h1' },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 't1', tool: 'Read', input: {} }, { tool_use_id: 't2', tool: 'Read', input: {} }], handle: 'h2' },
    {
      role: 'user',
      text: '',
      toolUses: [],
      toolResults: [
        { tool_use_id: 't1', text: 'x'.repeat(40000), isError: false, result: { bulk: true } },
        { tool_use_id: 't2', text: 'small', isError: false },
      ],
      handle: 'h3',
    },
    { role: 'assistant', text: 'Done.', toolUses: [], handle: 'h4' },
  ]
}

describe('parseCut', () => {
  test('reads a headspace-cut request', () => {
    expect(CUT_PREFIX).toBe('headspace-cut:')
    expect(parseCut('headspace-cut:{"marks":[{"id":"t1","label":"Read a.json (9.8k tokens)"}]}')).toEqual({
      marks: [{ id: 't1', label: LABEL }],
    })
  })

  test('tolerates whitespace around the text, as /compact may pass it', () => {
    expect(parseCut('  headspace-cut:{"marks":[{"id":"t1","label":"x"}]}\n')).toEqual({ marks: [{ id: 't1', label: 'x' }] })
  })

  test('is null for anything that is not a well-formed request', () => {
    expect(parseCut(undefined)).toBeNull()
    expect(parseCut('the plan')).toBeNull()
    expect(parseCut('headspace-cut:not json')).toBeNull()
    expect(parseCut('headspace-cut:{"marks":[{"id":1}]}')).toBeNull()
    expect(parseCut('headspace-cut:{"marks":[{"id":1,"label":"x"}]}')).toBeNull()
    expect(parseCut('headspace-cat:{"marks":[{"id":"t1","label":"x"}]}')).toBeNull()
    expect(parseCut('headspace-cut:{"marks":[{"id":"t1"}]}')).toBeNull()
    expect(parseCut('headspace-cut:{"marks":{"id":"t1","label":"x"}}')).toBeNull()
    expect(parseCut('headspace-cut:[1]')).toBeNull()
    expect(parseCut('headspace-cut:null')).toBeNull()
    expect(parseCut('headspace-cut:{"marks":[null]}')).toBeNull()
  })
})

describe('stubText', () => {
  test('names the result and says how to get it back', () => {
    expect(stubText(LABEL)).toBe('[headspace removed the result of Read a.json (9.8k tokens); run it again if you need it]')
  })
})

describe('cutMessages', () => {
  test('keeps an untouched message as the same object, handle and all', () => {
    const messages = conversation()
    const cut = cutMessages(messages, { marks: [{ id: 't1', label: LABEL }] })
    expect(cut.messages[0]).toBe(messages[0])
    expect(cut.messages[1]).toBe(messages[1])
    expect(cut.messages[3]).toBe(messages[3])
    expect((cut.messages[0] as Message).handle).toBe('h1')
    expect(cut.messages.length).toBe(4)
  })

  test('rebuilds a message holding a marked result without its handle, stubbing only the marked one', () => {
    const messages = conversation()
    const cut = cutMessages(messages, { marks: [{ id: 't1', label: LABEL }] })
    const rebuilt = cut.messages[2] as Message
    expect(rebuilt).not.toBe(messages[2])
    expect('handle' in rebuilt).toBe(false)
    expect(rebuilt.role).toBe('user')
    expect(rebuilt.toolResults).toEqual([
      { tool_use_id: 't1', text: stubText(LABEL), isError: false },
      { tool_use_id: 't2', text: 'small', isError: false },
    ])
    expect(cut.missing).toEqual([])
    // The input is left as it was.
    expect(messages[2]?.handle).toBe('h3')
    expect(messages[2]?.toolResults?.[0]?.text.length).toBe(40000)
  })

  test('lists a marked id that no message holds', () => {
    const cut = cutMessages(conversation(), { marks: [{ id: 't1', label: LABEL }, { id: 'gone', label: 'Bash ls (3k tokens)' }] })
    expect(cut.missing).toEqual(['gone'])
  })

  test('an empty request returns every message untouched', () => {
    const messages = conversation()
    const cut = cutMessages(messages, { marks: [] })
    expect(cut.missing).toEqual([])
    cut.messages.forEach((message, index) => expect(message).toBe(messages[index]))
  })
})
