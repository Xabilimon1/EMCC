import { describe, expect, test } from 'claude-code/testing'

import { diffLines, isReflected, parseRules, renderRules, shortPath } from '../hooks/rules'

const HEADINGS_AND_LISTS = [
  '# Git',
  '',
  '- Commit messages follow Conventional Commits.',
  '- Never push straight to main;',
  '  open a pull request instead.',
  '',
  '## Style',
  '',
  '* No emoji.',
  '+ English only.',
  '1. Numbered rules count too.',
  '',
].join('\n')

const NESTED = [
  '# Tools',
  '- Use the package manager of the repo:',
  '  - npm where there is a package-lock.json',
  '  - pnpm where there is a pnpm-lock.yaml',
  '- Run the tests before a commit.',
  '',
].join('\n')

const PARAGRAPHS = [
  'Read this file before anything else.',
  'It is short on purpose.',
  '',
  '# Tone',
  '',
  'Answer briefly.',
  '',
  'Say when you are not sure.',
  '',
].join('\n')

const FENCE = [
  '# Commands',
  '',
  '- Run the suite with:',
  '  ```sh',
  '  - not a rule',
  '  # not a heading',
  '  npm test',
  '  ```',
  '',
  '```',
  '- also not a rule',
  '',
  '# also not a heading',
  '```',
  '',
  '~~~',
  '- tilde fence',
  '~~~',
  '',
].join('\n')

const CRLF = '# A\r\n\r\n- one\r\n- two\r\n\r\nA paragraph.\r\n'
const NO_FINAL_NEWLINE = '# A\n- one\n- two'
const IMPORT = '# Shared\n\n@~/.claude/shared.md\n\n- local rule\n'
const FRONTMATTER = '---\ndescription: test\n---\n\n<!-- a note for humans -->\n\n- the only rule\n'

const SHAPES: Record<string, string> = {
  'headings with lists': HEADINGS_AND_LISTS,
  'nested lists': NESTED,
  'paragraph rules': PARAGRAPHS,
  'fenced blocks with - and # lines': FENCE,
  'CRLF line ends': CRLF,
  'no final newline': NO_FINAL_NEWLINE,
  'an @path import line': IMPORT,
  'frontmatter and a comment': FRONTMATTER,
  'an empty file': '',
  'a lone newline': '\n',
  'mixed line ends': '# A\r\n- one\n- two\r\n',
  'blank lines at the end': '- one\n\n\n',
}

const texts = (text: string) => parseRules(text).rules.map(r => r.lines.join('\n'))
const ruleOf = (text: string, startsWith: string) => {
  const rule = parseRules(text).rules.find(r => r.lines[0]!.trimStart().startsWith(startsWith))
  if (!rule) throw new Error(`no rule starting with ${startsWith}`)
  return rule
}

describe('renderRules with no changes', () => {
  for (const [name, text] of Object.entries(SHAPES)) {
    test(`is byte for byte: ${name}`, () => {
      const rendered = renderRules(parseRules(text), {})
      expect(rendered.text).toBe(text)
      expect(rendered.unknown).toEqual([])
    })
  }
})

describe('parseRules', () => {
  test('each top-level item is a rule with its continuation lines; headings are not rules', () => {
    const file = parseRules(HEADINGS_AND_LISTS)
    expect(file.rules.map(r => [r.heading, r.index, r.lines])).toEqual([
      ['# Git', 0, ['- Commit messages follow Conventional Commits.']],
      ['# Git', 1, ['- Never push straight to main;', '  open a pull request instead.']],
      ['## Style', 0, ['* No emoji.']],
      ['## Style', 1, ['+ English only.']],
      ['## Style', 2, ['1. Numbered rules count too.']],
    ])
    const second = file.rules[1]!
    expect([second.start, second.end]).toEqual([3, 5])
    expect(file.lines.slice(second.start, second.end)).toEqual(second.lines)
  })

  test('nested items belong to their parent', () => {
    expect(texts(NESTED)).toEqual([
      '- Use the package manager of the repo:\n  - npm where there is a package-lock.json\n  - pnpm where there is a pnpm-lock.yaml',
      '- Run the tests before a commit.',
    ])
  })

  test('an indented line after a blank line still continues the item', () => {
    expect(texts('- one\n\n  more of one\n\n- two\n\nA paragraph.\n')).toEqual(['- one\n\n  more of one', '- two', 'A paragraph.'])
  })

  test('a paragraph is a rule, the top of the file has heading empty', () => {
    const file = parseRules(PARAGRAPHS)
    expect(file.rules.map(r => [r.heading, r.index, r.lines.join('\n')])).toEqual([
      ['', 0, 'Read this file before anything else.\nIt is short on purpose.'],
      ['# Tone', 0, 'Answer briefly.'],
      ['# Tone', 1, 'Say when you are not sure.'],
    ])
  })

  test('a list item ends a paragraph above it', () => {
    expect(texts('Rules:\n- one\n- two\n')).toEqual(['Rules:', '- one', '- two'])
  })

  test('a fenced block is never split: inside an item, or a rule of its own', () => {
    expect(texts(FENCE)).toEqual([
      '- Run the suite with:\n  ```sh\n  - not a rule\n  # not a heading\n  npm test\n  ```',
      '```\n- also not a rule\n\n# also not a heading\n```',
      '~~~\n- tilde fence\n~~~',
    ])
    expect(parseRules(FENCE).rules.every(r => r.heading === '# Commands')).toBe(true)
  })

  test('a line right after a closing fence starts a new rule', () => {
    expect(texts('```\nx\n```\nAfter.\n')).toEqual(['```\nx\n```', 'After.'])
  })

  test('an unclosed fence runs to the end of the file', () => {
    expect(texts('- one\n```\n- two\n\n# three\n')).toEqual(['- one\n```\n- two\n\n# three'])
  })

  test('frontmatter and a comment block are not rules', () => {
    expect(texts(FRONTMATTER)).toEqual(['- the only rule'])
    expect(parseRules(FRONTMATTER).rules[0]!.index).toBe(0)
  })

  test('an @path import line is a rule', () => {
    expect(texts(IMPORT)).toEqual(['@~/.claude/shared.md', '- local rule'])
  })

  test('line ends and the final newline are recorded', () => {
    expect(parseRules(CRLF)).toMatchObject({ eol: '\r\n', finalNewline: true })
    expect(texts(CRLF)).toEqual(['- one', '- two', 'A paragraph.'])
    expect(parseRules(NO_FINAL_NEWLINE)).toMatchObject({ eol: '\n', finalNewline: false })
    expect(parseRules('# A\r\n- one\n- two\r\n')).toMatchObject({ eol: '\n', finalNewline: true })
    expect(texts('# A\r\n- one\n- two\r\n')).toEqual(['- one', '- two'])
    expect(parseRules('')).toEqual({ lines: [], rules: [], eol: '\n', finalNewline: false })
  })

  test('ids are heading, index and a hex hash of the text', () => {
    const id = parseRules(HEADINGS_AND_LISTS).rules[0]!.id
    expect(id).toMatch(/^# Git#0#[0-9a-f]{8}$/)
  })

  test('ids stay when an unrelated rule changes, and change with the rule’s own text', () => {
    const before = parseRules(HEADINGS_AND_LISTS).rules.map(r => r.id)
    const other = parseRules(HEADINGS_AND_LISTS.replace('No emoji.', 'No emoji at all.')).rules.map(r => r.id)
    expect(other[0]).toBe(before[0])
    expect(other[1]).toBe(before[1])
    expect(other[3]).toBe(before[3])
    expect(other[2]).not.toBe(before[2])

    const own = parseRules(HEADINGS_AND_LISTS.replace('Conventional Commits', 'Conventional Commits 1.0')).rules.map(r => r.id)
    expect(own[0]).not.toBe(before[0])
    expect(own.slice(1)).toEqual(before.slice(1))
  })

  test('two identical rules under the same heading text still get distinct ids', () => {
    const ids = parseRules('# A\n- same\n# A\n- same\n').rules.map(r => r.id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('renderRules with changes', () => {
  test('off removes exactly the rule’s lines', () => {
    const file = parseRules(HEADINGS_AND_LISTS)
    const rule = ruleOf(HEADINGS_AND_LISTS, '- Never')
    const { text, unknown } = renderRules(file, { [rule.id]: [{ type: 'off' }] })
    expect(unknown).toEqual([])
    expect(text).toBe(HEADINGS_AND_LISTS.replace('- Never push straight to main;\n  open a pull request instead.\n', ''))
  })

  test('off wins over an edit of the same rule', () => {
    const rule = ruleOf(NESTED, '- Run')
    const { text } = renderRules(parseRules(NESTED), { [rule.id]: [{ type: 'edit', lineIndex: 0, text: '- x' }, { type: 'off' }] })
    expect(text).toBe(NESTED.replace('- Run the tests before a commit.\n', ''))
  })

  test('edit replaces one line of the rule', () => {
    const rule = ruleOf(NESTED, '- Use')
    const { text } = renderRules(parseRules(NESTED), { [rule.id]: [{ type: 'edit', lineIndex: 2, text: '  - pnpm where there is a pnpm-workspace.yaml' }] })
    expect(text).toBe(NESTED.replace('pnpm-lock.yaml', 'pnpm-workspace.yaml'))
  })

  test('addLine inserts one line after the given line of the rule', () => {
    const rule = ruleOf(NESTED, '- Use')
    const { text } = renderRules(parseRules(NESTED), { [rule.id]: [{ type: 'addLine', afterLineIndex: 1, text: '  - yarn where there is a yarn.lock' }] })
    expect(text).toBe(NESTED.replace('package-lock.json\n', 'package-lock.json\n  - yarn where there is a yarn.lock\n'))
  })

  test('addLine after -1 inserts before the rule’s first line', () => {
    const rule = ruleOf(NESTED, '- Run')
    const { text } = renderRules(parseRules(NESTED), { [rule.id]: [{ type: 'addLine', afterLineIndex: -1, text: '- Read the README.' }] })
    expect(text).toBe(NESTED.replace('- Run the tests', '- Read the README.\n- Run the tests'))
  })

  test('a line index outside the rule is ignored', () => {
    const rule = ruleOf(NESTED, '- Use')
    const { text, unknown } = renderRules(parseRules(NESTED), {
      [rule.id]: [{ type: 'edit', lineIndex: 3, text: 'x' }, { type: 'addLine', afterLineIndex: 3, text: 'y' }],
    })
    expect(text).toBe(NESTED)
    expect(unknown).toEqual([])
  })

  test('two changes on different rules both apply', () => {
    const file = parseRules(PARAGRAPHS)
    const first = ruleOf(PARAGRAPHS, 'Read')
    const last = ruleOf(PARAGRAPHS, 'Say')
    const { text } = renderRules(file, {
      [first.id]: [{ type: 'edit', lineIndex: 1, text: 'It is long on purpose.' }],
      [last.id]: [{ type: 'off' }],
    })
    expect(text).toBe('Read this file before anything else.\nIt is long on purpose.\n\n# Tone\n\nAnswer briefly.\n\n')
  })

  test('changes keep the file’s CRLF line ends and its missing final newline', () => {
    const crlf = parseRules(CRLF)
    const { text } = renderRules(crlf, { [crlf.rules[0]!.id]: [{ type: 'addLine', afterLineIndex: 0, text: '- one and a half\n  and more' }] })
    expect(text).toBe('# A\r\n\r\n- one\r\n- one and a half\r\n  and more\r\n- two\r\n\r\nA paragraph.\r\n')

    const bare = parseRules(NO_FINAL_NEWLINE)
    expect(renderRules(bare, { [bare.rules[1]!.id]: [{ type: 'edit', lineIndex: 0, text: '- 2' }] }).text).toBe('# A\n- one\n- 2')
  })

  test('an unknown id is reported, not applied', () => {
    const file = parseRules(NESTED)
    const rule = ruleOf(NESTED, '- Run')
    const { text, unknown } = renderRules(file, { 'gone#0#deadbeef': [{ type: 'off' }], [rule.id]: [{ type: 'off' }] })
    expect(unknown).toEqual(['gone#0#deadbeef'])
    expect(text).toBe(NESTED.replace('- Run the tests before a commit.\n', ''))
  })
})

describe('diffLines', () => {
  test('a removed rule shows its lines out and the rest same', () => {
    const rule = ruleOf(HEADINGS_AND_LISTS, '- Never')
    const after = renderRules(parseRules(HEADINGS_AND_LISTS), { [rule.id]: [{ type: 'off' }] }).text
    const diff = diffLines(HEADINGS_AND_LISTS, after)
    expect(diff.filter(d => d.type === 'out').map(d => d.text)).toEqual(['- Never push straight to main;', '  open a pull request instead.'])
    expect(diff.some(d => d.type === 'in')).toBe(false)
    expect(diff.filter(d => d.type === 'same').map(d => d.text)).toEqual(after.split('\n').slice(0, -1))
    expect(diff.map(d => d.text)).toEqual(HEADINGS_AND_LISTS.split('\n').slice(0, -1))
  })

  test('an edited line shows out then in, in place', () => {
    expect(diffLines('a\nb\nc\n', 'a\nB\nc\n')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'out', text: 'b' },
      { type: 'in', text: 'B' },
      { type: 'same', text: 'c' },
    ])
  })

  test('CRLF text diffs by line, without the carriage returns', () => {
    expect(diffLines('a\r\nb\r\n', 'a\r\n')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'out', text: 'b' },
    ])
    expect(diffLines('', '')).toEqual([])
  })
})

describe('isReflected', () => {
  const BEFORE = '# Git\n\n- One.\n- Two.\n- Three.\n'
  const id = (words: string, text = BEFORE) => parseRules(text).rules.find(r => r.lines[0]?.includes(words))?.id ?? ''

  test('a rule turned off is in the text when its lines are gone and the rules after it moved up', () => {
    expect(isReflected(parseRules(BEFORE), parseRules('# Git\n\n- One.\n- Three.\n'), id('Two'), [{ type: 'off' }])).toBe(true)
    // The last rule gone: nothing at its place.
    expect(isReflected(parseRules(BEFORE), parseRules('# Git\n\n- One.\n- Two.\n'), id('Three'), [{ type: 'off' }])).toBe(true)
  })

  test('a rule turned off and rewritten by hand is not in the text', () => {
    expect(isReflected(parseRules(BEFORE), parseRules('# Git\n\n- One.\n- Two, always.\n- Three.\n'), id('Two'), [{ type: 'off' }])).toBe(false)
  })

  test('a rule turned off whose lines are still there, moved, is not in the text', () => {
    expect(isReflected(parseRules(BEFORE), parseRules('# Git\n\n- One.\n- Three.\n- Two.\n'), id('Two'), [{ type: 'off' }])).toBe(false)
  })

  test('an edit or an added line is in the text when a rule reads as the change makes it', () => {
    const changes = [{ type: 'edit' as const, lineIndex: 0, text: '- Deux.' }, { type: 'addLine' as const, afterLineIndex: 0, text: '  and more.' }]
    expect(isReflected(parseRules(BEFORE), parseRules('# Git\n\n- One.\n- Deux.\n  and more.\n- Three.\n'), id('Two'), changes)).toBe(true)
    expect(isReflected(parseRules(BEFORE), parseRules('# Git\n\n- One.\n- Deux.\n- Three.\n'), id('Two'), changes)).toBe(false)
  })

  test('a text without the rule tells nothing', () => {
    expect(isReflected(parseRules('- Other.\n'), parseRules(BEFORE), id('Two'), [{ type: 'off' }])).toBeNull()
  })
})

describe('shortPath', () => {
  test('a path under the session root is relative to it', () => {
    expect(shortPath('/repo/CLAUDE.md', '/repo', '/home/me')).toBe('CLAUDE.md')
    expect(shortPath('/repo/docs/rules.md', '/repo/', '/home/me')).toBe('docs/rules.md')
  })

  test('a path under the home directory starts with ~/', () => {
    expect(shortPath('/home/me/.claude/CLAUDE.md', '/repo', '/home/me')).toBe('~/.claude/CLAUDE.md')
    expect(shortPath('/home/me/.claude/CLAUDE.md', '/repo', '/home/me/')).toBe('~/.claude/CLAUDE.md')
  })

  test('the session root wins over the home directory it sits in', () => {
    expect(shortPath('/home/me/proj/CLAUDE.md', '/home/me/proj', '/home/me')).toBe('CLAUDE.md')
  })

  test('a name that only begins like the root or the home directory is not under it', () => {
    expect(shortPath('/repo2/CLAUDE.md', '/repo', '/home/me')).toBe('/repo2/CLAUDE.md')
    expect(shortPath('/home/meow/CLAUDE.md', '/repo', '/home/me')).toBe('/home/meow/CLAUDE.md')
  })

  test('anything else, or without a root and a home, stays as it is', () => {
    expect(shortPath('/etc/claude/CLAUDE.md', '/repo', '/home/me')).toBe('/etc/claude/CLAUDE.md')
    expect(shortPath('/repo/CLAUDE.md', null, null)).toBe('/repo/CLAUDE.md')
    // A root or home of / would make every path relative to nothing in particular.
    expect(shortPath('/etc/claude/CLAUDE.md', '/', '/')).toBe('/etc/claude/CLAUDE.md')
  })
})
