import type { ApiMessage } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { cacheCost, cutInstructions, label, largeResults } from '../hooks/large'

const CWD = '/repo'

const prompt = (text: string): ApiMessage => ({ role: 'user', content: [{ type: 'text', text }] })
const call = (id: string, name: string, input: Record<string, unknown>): ApiMessage => ({
  role: 'assistant',
  content: [{ type: 'tool_use', id, name, input }],
})
const result = (id: string, content: unknown): ApiMessage => ({
  role: 'user',
  content: [{ type: 'tool_result', tool_use_id: id, content }],
})
const answer = (text: string): ApiMessage => ({ role: 'assistant', content: [{ type: 'text', text }] })

/** A Read of `chars` characters, its call and its result. */
const read = (id: string, chars: number, file = '/repo/src/data.json'): ApiMessage[] => [
  call(id, 'Read', { file_path: file }),
  result(id, 'x'.repeat(chars)),
]

describe('largeResults', () => {
  test('a 40k-character Read is large with 10000 tokens when there is no Messages figure', async () => {
    const { results } = largeResults([prompt('read it'), ...read('r1', 40_000)], 2000, null, CWD)
    expect(results.length).toBe(1)
    expect(results[0]?.id).toBe('r1')
    expect(results[0]?.tool).toBe('Read')
    expect(results[0]?.chars).toBe(40_000)
    expect(results[0]?.tokens).toBe(10_000)
  })

  test('a 4k-character result is not large', async () => {
    const { results, share } = largeResults([prompt('read it'), ...read('r1', 4000)], 2000, null, CWD)
    expect(results).toEqual([])
    expect(share).toBe(0)
  })

  test('the threshold is inclusive: exactly 2000 tokens is large', async () => {
    const { results } = largeResults([prompt('read it'), ...read('r1', 8000)], 2000, null, CWD)
    expect(results.map(r => r.id)).toEqual(['r1'])
  })

  test('with a Messages figure, a result takes its share of it in proportion to characters', async () => {
    // Fact 7: a 36,205-character Read among about 40k characters of messages, Messages 4052 tokens.
    const messages = [prompt('p'.repeat(3795)), ...read('r1', 36_205)]
    const { results, share } = largeResults(messages, 2000, 4052, CWD)
    expect(results.length).toBe(1)
    const tokens = results[0]?.tokens ?? 0
    expect(tokens).toBeGreaterThan(3600)
    expect(tokens).toBeLessThan(3800)
    expect(share).toBe(tokens / 4052)
  })

  test('string content and text-block content are both measured', async () => {
    const blocks = [
      { type: 'text', text: 'a'.repeat(5000) },
      { type: 'text', text: 'b'.repeat(5000) },
    ]
    const messages = [prompt('go'), call('s', 'Read', { file_path: '/repo/a' }), result('s', 'y'.repeat(9000)), call('b', 'Read', { file_path: '/repo/b' }), result('b', blocks)]
    const { results } = largeResults(messages, 2000, null, CWD)
    expect(results.map(r => r.id)).toEqual(['b', 's'])
    expect(results[1]?.chars).toBe(9000)
    expect(results[0]?.chars).toBeGreaterThanOrEqual(10_000)
  })

  test('results are biggest first', async () => {
    const messages = [prompt('go'), ...read('small', 10_000), ...read('big', 30_000), ...read('mid', 20_000)]
    const { results } = largeResults(messages, 2000, null, CWD)
    expect(results.map(r => r.id)).toEqual(['big', 'mid', 'small'])
  })

  test('a result headspace already stubbed is left out', async () => {
    const stub = '[headspace removed the result of Read src/data.json (9.8k tokens); run it again if you need it]'
    const messages = [prompt('go'), call('r1', 'Read', { file_path: '/repo/src/data.json' }), result('r1', stub + ' '.repeat(40_000))]
    expect(largeResults(messages, 2000, null, CWD).results).toEqual([])
  })

  test('turnsAgo counts only the prompts typed after the result', async () => {
    const reminder: ApiMessage = { role: 'user', content: [{ type: 'text', text: '<system-reminder>\nnote\n</system-reminder>' }] }
    const messages = [
      prompt('first'),
      ...read('r1', 40_000),
      answer('done'),
      prompt('second'),
      call('t', 'Bash', { command: 'ls' }),
      result('t', 'a'),
      reminder,
      answer('ok'),
      prompt('third'),
    ]
    const { results } = largeResults(messages, 2000, null, CWD)
    expect(results[0]?.turnsAgo).toBe(2)
  })

  test('a result in the last turn is 0 turns ago', async () => {
    const { results } = largeResults([prompt('go'), ...read('r1', 40_000)], 2000, null, CWD)
    expect(results[0]?.turnsAgo).toBe(0)
  })

  test('preview is the first 20 lines', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i} ${'z'.repeat(400)}`)
    const messages = [prompt('go'), call('r1', 'Read', { file_path: '/repo/a' }), result('r1', lines.join('\n'))]
    const { results } = largeResults(messages, 2000, null, CWD)
    expect(results[0]?.preview).toEqual(lines.slice(0, 20))
  })

  test('targets per tool', async () => {
    const big = 'q'.repeat(10_000)
    const pairs: [string, Record<string, unknown>][] = [
      ['Read', { file_path: '/repo/src/data.json' }],
      ['Edit', { file_path: '/elsewhere/notes.md' }],
      ['Write', { file_path: '/repository/x.ts' }],
      ['Bash', { command: 'npm test -- --reporter verbose --coverage --watch=false\nsecond line' }],
      ['WebFetch', { url: 'https://docs.anthropic.com/en/docs/intro?x=1#top' }],
      ['Grep', { pattern: 'TODO' }],
      ['Glob', { pattern: '**/*.ts' }],
      ['Task', { prompt: 'do it' }],
    ]
    const messages: ApiMessage[] = [prompt('go')]
    pairs.forEach(([tool, input], i) => messages.push(call(`id${i}`, tool, input), result(`id${i}`, big + 'q'.repeat(i))))
    const { results } = largeResults(messages, 2000, null, CWD)
    const targets = Object.fromEntries(results.map(r => [r.tool, r.target]))
    expect(targets).toEqual({
      Read: 'src/data.json',
      Edit: '/elsewhere/notes.md',
      Write: '/repository/x.ts',
      Bash: 'npm test -- --reporter verbose --coverag',
      WebFetch: 'docs.anthropic.com/en/docs/intro',
      Grep: 'TODO',
      Glob: '**/*.ts',
      Task: '',
    })
  })
})

describe('label', () => {
  test('names the tool, the target and the tokens', async () => {
    const { results } = largeResults([prompt('go'), ...read('r1', 39_200)], 2000, null, CWD)
    const first = results[0]
    expect(first).toBeDefined()
    if (first) {
      expect(label(first)).toBe('Read src/data.json (9.8k tokens)')
      expect(label({ ...first, target: '', tool: 'Task', tokens: 148_000 })).toBe('Task (148k tokens)')
      expect(label({ ...first, tokens: 9234 })).toBe('Read src/data.json (9.2k tokens)')
      expect(label({ ...first, tokens: 10_000 })).toBe('Read src/data.json (10k tokens)')
      expect(label({ ...first, tokens: 950 })).toBe('Read src/data.json (950 tokens)')
      expect(label({ ...first, tokens: 1_234_000 })).toBe('Read src/data.json (1.2M tokens)')
    }
  })
})

describe('cacheCost', () => {
  test('sums the tokens from the first marked result to the end', async () => {
    const messages = [prompt('a'.repeat(1000)), ...read('r1', 8000), answer('b'.repeat(2000)), ...read('r2', 4000), answer('c'.repeat(1000))]
    // Without a Messages figure: characters / 4. From r1 on: 8000 + 2000 + call r2 + 4000 + 1000.
    const fromR1 = cacheCost(messages, ['r2', 'r1'], null)
    const fromR2 = cacheCost(messages, ['r2'], null)
    expect(fromR1).toBeGreaterThan(fromR2)
    expect(fromR1).toBeGreaterThanOrEqual((8000 + 2000 + 4000 + 1000) / 4)
    expect(fromR1).toBeLessThan((8000 + 2000 + 4000 + 1000) / 4 + 30)
    expect(fromR2).toBeGreaterThanOrEqual((4000 + 1000) / 4)
    expect(fromR2).toBeLessThan((4000 + 1000) / 4 + 10)
  })

  test('with a Messages figure the cost is its proportional share', async () => {
    const messages = [prompt('a'.repeat(10_000)), ...read('r1', 10_000)]
    const cost = cacheCost(messages, ['r1'], 1000)
    expect(cost).toBeGreaterThan(490)
    expect(cost).toBeLessThan(510)
  })

  test('no marked result found costs nothing', async () => {
    expect(cacheCost([prompt('go'), ...read('r1', 8000)], ['nope'], null)).toBe(0)
    expect(cacheCost([prompt('go'), ...read('r1', 8000)], [], null)).toBe(0)
  })
})

describe('cutInstructions', () => {
  const marks = [
    { id: 'toolu_1', label: 'Read src/data.json (9.8k tokens)' },
    { id: 'toolu_2', label: 'Bash npm test (4.1k tokens)' },
  ]

  test('starts with the headspace-cut prefix', async () => {
    expect(cutInstructions(marks).startsWith('headspace-cut:')).toBe(true)
  })

  // The test runner refuses imports from another plugin's folder, so this
  // spells headspace-cut's CUT_PREFIX and parseCut's reading literally.
  test('parses back the way headspace-cut reads it', async () => {
    const text = cutInstructions(marks)
    const PREFIX = 'headspace-cut:'
    expect(text.startsWith(PREFIX)).toBe(true)
    expect(JSON.parse(text.trim().slice(PREFIX.length))).toEqual({ marks })
  })
})
