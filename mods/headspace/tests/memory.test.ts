import { describe, expect, test } from 'claude-code/testing'

import { memoryEntries, renderMemory } from '../hooks/memory'

const SECTION = [
  '# auto memory',
  '',
  'You have a persistent, file-based memory system at `/Users/me/.claude/memory/`.',
  '- Save a memory when the person asks you to remember something.',
  '- Each entry in MEMORY.md is one line: `- [Title](file.md) — one-line hook`.',
  '- [Not a link] at the start, then prose.',
  '',
  '## MEMORY.md',
  '',
  '- [Deploy always](feedback_deploy.md) — commit and deploy after every task',
  '- [Homelab off](project_homelab.md) — x-node and x-server are off',
  '- [Password store](reference_pass.md) — pass, GPG, auto-push',
  '',
  'Read MEMORY.md at the start of every session.',
].join('\n')

describe('memoryEntries', () => {
  test('finds the index entries among the instruction prose, in order', async () => {
    const entries = memoryEntries(SECTION)
    expect(entries.map((entry) => entry.title)).toEqual(['Deploy always', 'Homelab off', 'Password store'])
    expect(entries[1]?.line).toBe('- [Homelab off](project_homelab.md) — x-node and x-server are off')
    for (const entry of entries) expect(entry.id.startsWith('memory#')).toBe(true)
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(3)
  })

  test('prose lines that start with "- " but are not "- [x](y)" links are not entries', async () => {
    const entries = memoryEntries(
      [
        '- Save a memory when asked.',
        '- [Not a link] at the start, then prose.',
        '- [Empty target]() is not a link either.',
        '-[No space](file.md) is not an item.',
        '  - [Indented](file.md) belongs to another item.',
        '- [Real](real.md) — the only entry',
      ].join('\n'),
    )
    expect(entries.map((entry) => entry.title)).toEqual(['Real'])
  })

  test('a link inside a code fence is an example, not an entry', async () => {
    const entries = memoryEntries(['```markdown', '- [Example](example.md) — hook', '```', '- [Real](real.md)'].join('\n'))
    expect(entries.map((entry) => entry.title)).toEqual(['Real'])
  })

  test('ids are stable when other entries are reordered, added or removed', async () => {
    const idOf = (text: string, title: string) => memoryEntries(text).find((entry) => entry.title === title)?.id
    const a = '- [One](one.md) — first\n- [Two](two.md) — second\n- [Three](three.md) — third'
    const b = '- [Three](three.md) — third\n- [Zero](zero.md) — new\n- [Two](two.md) — second'
    expect(idOf(a, 'Two')).toBeDefined()
    expect(idOf(b, 'Two')).toBe(idOf(a, 'Two'))
    expect(idOf(b, 'Three')).toBe(idOf(a, 'Three'))
    expect(idOf(a, 'One')).not.toBe(idOf(a, 'Two'))
  })

  test('a changed line is a different entry', async () => {
    const [before] = memoryEntries('- [One](one.md) — first')
    const [after] = memoryEntries('- [One](one.md) — first, edited')
    expect(after?.id).not.toBe(before?.id)
  })

  test('a CRLF line is the same entry as its LF twin', async () => {
    const [lf] = memoryEntries('- [One](one.md) — first\nprose')
    const [crlf] = memoryEntries('- [One](one.md) — first\r\nprose')
    expect(crlf?.line).toBe('- [One](one.md) — first')
    expect(crlf?.id).toBe(lf?.id)
  })

  test('an identical line repeated is one entry', async () => {
    expect(memoryEntries('- [One](one.md) — first\n- [One](one.md) — first').length).toBe(1)
  })

  test('no section text, no entries', async () => {
    expect(memoryEntries('')).toEqual([])
  })
})

describe('renderMemory', () => {
  test('with nothing off the text is identical byte for byte', async () => {
    expect(renderMemory(SECTION, new Set())).toBe(SECTION)
    const odd = '\r\n- [One](one.md)\r\n\r\n```\n- [Two](two.md)\n```\ntrailing  \n\n'
    expect(renderMemory(odd, new Set())).toBe(odd)
  })

  test('turning one entry off removes only its line', async () => {
    const homelab = memoryEntries(SECTION).find((entry) => entry.title === 'Homelab off')
    const out = renderMemory(SECTION, new Set([homelab?.id ?? '']))
    expect(out).toBe(SECTION.replace('- [Homelab off](project_homelab.md) — x-node and x-server are off\n', ''))
    expect(memoryEntries(out).map((entry) => entry.title)).toEqual(['Deploy always', 'Password store'])
  })

  test('the last line off leaves no stray newline, and its CRLF goes with it', async () => {
    const [, two] = memoryEntries('- [One](one.md)\n- [Two](two.md)')
    expect(renderMemory('- [One](one.md)\n- [Two](two.md)', new Set([two?.id ?? '']))).toBe('- [One](one.md)')
    const [one] = memoryEntries('- [One](one.md)\r\n- [Two](two.md)\r\n')
    expect(renderMemory('- [One](one.md)\r\n- [Two](two.md)\r\n', new Set([one?.id ?? '']))).toBe('- [Two](two.md)\r\n')
  })

  test('an id that is not an entry, or a matching line in a fence, is left alone', async () => {
    const text = '```\n- [One](one.md)\n```\n- [One](one.md)'
    const [one] = memoryEntries(text)
    expect(renderMemory(text, new Set(['memory#nothing']))).toBe(text)
    expect(renderMemory(text, new Set([one?.id ?? '']))).toBe('```\n- [One](one.md)\n```')
  })
})
