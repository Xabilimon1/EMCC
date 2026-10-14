import { describe, expect, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'

import { parseRules } from '../hooks/rules'
import { probe } from './fixtures/probe'
import { command, endTurn, seed, session, startTurn, state } from './fixtures/session'
import type { Row, Session } from './fixtures/session'

const SURFACES = ['terminal', 'desktop'] as const
const WITH_PROBE = { plugins: [probe] }

const STONE = '#b0aea5'
const CLAY = '#d97757'
const SKY = '#6a9bcc'
const OLIVE = '#788c5d'

const ROWS: Row[] = [
  { name: 'System prompt', tokens: 3000, kind: 'used' },
  { name: 'System tools', tokens: 12000, kind: 'used' },
  { name: 'MCP tools (deferred)', tokens: 9000, kind: 'deferred' },
  { name: 'Memory files', tokens: 4000, kind: 'used' },
  { name: 'Messages', tokens: 10000, kind: 'used' },
  { name: 'Free space', tokens: 138000, kind: 'free' },
  { name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' },
]

/** A Read of 30,000 characters and a short answer: with Messages at 10k, the Read is about 9.9k tokens. */
function conversation() {
  return [
    { role: 'user', content: [{ type: 'text', text: 'Read the data.' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/repo/src/data.json' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'first line\n' + 'x'.repeat(30000) }] },
    { role: 'assistant', content: [{ type: 'text', text: 'It holds the data.' }] },
  ]
}

const PROJECT = '/repo/CLAUDE.md'
const MANAGED = '/etc/claude/CLAUDE.md'
const PROJECT_TEXT = '# Git\n\n- Commit messages follow Conventional Commits.\n- Never push straight to main.\n'
const MANAGED_TEXT = '- Follow the security policy.\n'
const FILES = [
  { path: MANAGED, kind: 'managed', content: MANAGED_TEXT },
  { path: PROJECT, kind: 'project', content: PROJECT_TEXT },
]
const CLAUDE_MD = `Contents of ${MANAGED}:\n\n${MANAGED_TEXT}\n\nContents of ${PROJECT}:\n\n${PROJECT_TEXT}`
const BLOCKS = [{ name: 'claudeMd', text: CLAUDE_MD }]

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120, scroll: { offset: 0, bodyRows: 3 }, view: {} },
} as const

const PANE = {
  component: 'Pane',
  requestId: 'headspace',
  props: { title: 'headspace', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  viewport: { rows: 60, columns: 80 },
} as const

type Surface = (typeof SURFACES)[number]

const band = ($: Engine, surface: Surface = 'terminal', bodyColumns = 120) =>
  $.ui.mount({ plugin: 'headspace', surface, ...BAND, props: { ...BAND.props, bodyColumns } } as never)
const pane = ($: Engine, surface: Surface = 'terminal') => $.ui.mount({ plugin: 'headspace', surface, ...PANE } as never)

/** The engine's own band beneath headspace: shows when headspace passes. */
function engineBand(on: Parameters<typeof session>[0]): void {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine band</Text>
  })
}

/** The session root and the home directory, as the engine answers them. */
function paths(on: Parameters<typeof session>[0], root = '/repo', home = '/home/me'): void {
  on('session.root', () => ({ value: root }) as never)
  on('env.get', (_$, e) => ({ value: (e as unknown as { name: string }).name === 'HOME' ? home : undefined }) as never)
}

/** The context as the engine computes it: what tells headspace the files behind claudeMd. */
function context($: Engine) {
  return $.prompt.context({ blocks: BLOCKS, instructionFiles: FILES } as never)
}

/** A session with a full breakdown, the Read in the conversation, and the files read once. */
async function filled($: Engine, it: Session): Promise<void> {
  it.categories = ROWS
  it.percent = 31
  it.api = conversation()
  await context($)
  await endTurn($)
}

/** The ids of the project file's rules. */
function ruleId(words: string): string {
  const rule = parseRules(PROJECT_TEXT).rules.find(r => r.lines[0]?.includes(words))
  if (rule === undefined) {
    throw new Error(`no rule with ${words}`)
  }

  return rule.id
}

/** Every string a found element and its children show, joined. */
function shown(element: unknown): string {
  if (typeof element === 'string' || typeof element === 'number') {
    return String(element)
  }
  if (element === null || typeof element !== 'object') {
    return ''
  }
  const { props, children } = element as { props?: { label?: unknown }; children?: unknown[] }
  const label = typeof props?.label === 'string' ? props.label : ''

  return label + (children ?? []).map(shown).join('')
}

/** The person answering `$.ui.ask`, one answer per question in order; a question past them is dismissed. */
function answering(on: Parameters<typeof session>[0], answers: string[]): { asked: string[] } {
  const it = { asked: [] as string[] }
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const [question] = (e as unknown as { questions: { question: string }[] }).questions
    it.asked.push(question?.question ?? '')
    const answer = answers.shift()
    if (answer === undefined) {
      return { isError: true, result: 'dismissed', text: 'The user dismissed the question' } as never
    }

    return { result: { questions: [question], answers: { [question?.question ?? '']: answer } } } as never
  })

  return it
}

/**
 * The cells a row takes: its Texts and Buttons side by side, with each Box's
 * gap between its children. What a hover-only Box holds, or an absolute one,
 * takes none.
 */
function rowWidth(tree: unknown): number {
  if (typeof tree === 'string' || typeof tree === 'number') {
    return String(tree).length
  }
  if (tree === null || typeof tree !== 'object') {
    return 0
  }
  const { type, props, children } = tree as { type?: string; props?: { label?: string; display?: string; position?: string; gap?: number }; children?: unknown[] }
  if (type === 'Button') {
    return props?.label?.length ?? 0
  }
  if (props?.display === 'none' || props?.position === 'absolute') {
    return 0
  }
  const parts = (children ?? []).map(rowWidth).filter(width => width > 0)

  return parts.reduce((sum, width) => sum + width, 0) + (type === 'Box' ? (props?.gap ?? 0) * Math.max(0, parts.length - 1) : 0)
}

/** The engine beneath headspace with nothing of its own to show: an empty band. */
function quietBand(on: Parameters<typeof session>[0]): void {
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
}

/** Another plugin drawing the band beneath headspace, as emcc-core or witness do; it says the rows it was given. */
const otherBand: Plugin = {
  name: 'other-band',
  tier: 'builtin',
  register(on) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Text } = $.ui.resolve(e)

      return <Text>{`other band in ${e.props.maxRows} rows`}</Text>
    })
  },
}

/** The element keyed `key` in a drawn tree, as drawn: its `hover` included, which a found element leaves out. */
function keyed(tree: unknown, key: string): { props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] } | undefined {
  if (tree === null || typeof tree !== 'object') {
    return undefined
  }
  const node = tree as { props?: Record<string, unknown>; children?: unknown[] }
  if (node.props?.key === key) {
    return node
  }
  for (const child of node.children ?? []) {
    const found = keyed(child, key)
    if (found !== undefined) {
      return found
    }
  }

  return undefined
}

/** The keys of the Buttons drawn where they show at rest: under no Box drawn `display: none`. */
function visibleButtons(tree: unknown): string[] {
  if (tree === null || typeof tree !== 'object') {
    return []
  }
  const { type, props, children } = tree as { type?: string; props?: { key?: string; display?: string }; children?: unknown[] }
  if (type === 'Button') {
    return [props?.key ?? '']
  }
  if (props?.display === 'none') {
    return []
  }

  return (children ?? []).flatMap(visibleButtons)
}

describe('the band', () => {
  test('without a snapshot it passes to the engine', WITH_PROBE, async ($, on) => {
    session(on)
    engineBand(on)
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('a full snapshot draws the six kinds in their colours, then the percentage', WITH_PROBE, async ($, on) => {
    const it = session(on)
    quietBand(on)
    await filled($, it)
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      const cells = (await ui.findAll({ type: 'Text', text: /^[█░▁]+$/ })).map(one => [one.text[0], one.props.color, one.props.dimColor === true])
      expect(cells).toEqual([
        ['█', STONE, false],
        ['█', CLAY, false],
        ['█', SKY, false],
        ['█', OLIVE, false],
        // free is an empty rail, so it never reads as one more grey block beside system
        ['▁', STONE, true],
        ['░', STONE, false],
      ])
      expect((await ui.find({ key: 'label-percent' }))?.text).toBe('31%')
      for (const kind of ['system', 'rules', 'conversation', 'large', 'free', 'reserve']) {
        expect(await ui.find({ key: `seg-${kind}` })).toBeDefined()
      }
      // Nothing beneath to show: the band is headspace's one row.
      expect((await ui.drawn()).type).toBe('Box')
      expect(keyed(await ui.drawn(), 'label-percent')).toBeDefined()
      expect((await ui.drawn() as { props?: { flexDirection?: string } }).props?.flexDirection).toBeUndefined()
      await ui.unmount()
    }
  })

  test('another plugin’s band beneath is drawn under headspace’s row, never swallowed', { plugins: [probe, otherBand] }, async ($, on) => {
    const it = session(on)
    await filled($, it)
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      const tree = (await ui.drawn()) as { props?: { flexDirection?: string }; children?: unknown[] }
      expect(tree.props?.flexDirection).toBe('column')
      // headspace's row first, then the band beneath, which was given the rows headspace's row leaves.
      expect(shown(tree.children?.[0])).toContain('31%')
      expect(shown(tree.children?.[1])).toBe('other band in 2 rows')
      await ui.unmount()
    }
  })

  test('with nothing to show, the band beneath is handed on unchanged', { plugins: [probe, otherBand] }, async ($, on) => {
    session(on)
    const ui = await band($)
    expect(await ui.drawn()).toMatchObject({ type: 'Text', children: ['other band in 3 rows'] })
    await ui.unmount()
  })

  test('a kind of 1 token still draws one cell', WITH_PROBE, async ($, on) => {
    const it = session(on)
    quietBand(on)
    it.categories = ROWS.map(row => (row.name === 'Memory files' ? { ...row, tokens: 1 } : row))
    await endTurn($)
    const ui = await band($)
    const rules = (await ui.findAll({ type: 'Text', text: /^█+$/ })).filter(one => one.props.color === CLAY)
    expect(rules.map(one => one.text)).toEqual(['█'])
    await ui.unmount()
  })

  test('the pointer on a segment shows its card in the band’s own row, over the labels', WITH_PROBE, async ($, on) => {
    const it = session(on)
    quietBand(on)
    await filled($, it)
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      const actions: Record<string, string> = {
        system: 'view only',
        rules: 'click to view and remove',
        conversation: 'view only',
        large: 'click to view and remove',
        free: 'view only',
        reserve: 'view only',
      }
      for (const [kind, action] of Object.entries(actions)) {
        const card = await ui.find({ key: `card-${kind}` })
        // In the row (top 0, never above it: the band clips what leaves it), hidden until its segment is hovered.
        expect(card?.props).toMatchObject({ position: 'absolute', top: 0, display: 'none' })
        expect(keyed(await ui.drawn(), `card-${kind}`)?.hover).toEqual({ display: 'flex', scope: `headspace-${kind}` })
        const text = shown(card)
        expect(text.startsWith(`${kind} `)).toBe(true)
        expect(text).toContain(action)
        const other = action === 'view only' ? 'click to view and remove' : 'view only'
        expect(text.includes(other)).toBe(false)
        // The segment's cells heat the same group.
        const cells = keyed(await ui.drawn(), `seg-${kind}`)?.children?.[0] as { hover?: { scope?: string } }
        expect(cells.hover?.scope).toBe(`headspace-${kind}`)
      }
      // One line, as wide as the labels it covers, so none shows through.
      const rules = shown(await ui.find({ key: 'card-rules' }))
      expect(rules.trimEnd()).toBe('rules 4k  3 rules  click to view and remove')
      expect(rules.length).toBe((await ui.find({ key: 'card-rules' }))?.props.width)
      expect(shown(await ui.find({ key: 'card-large' }))).toContain('1 result')
      await ui.unmount()
    }
  })

  test('pressing the rules segment opens the pane on rules', WITH_PROBE, async ($, on) => {
    const it = session(on)
    quietBand(on)
    await filled($, it)
    await command($, 'headspace', 'large')
    expect(await state($, 'selected')).toBe('large')
    const ui = await band($)
    expect((await ui.find({ key: 'open-rules' }))?.type).toBe('Button')
    await ui.press({ key: 'open-rules' })
    await it.clock.settle()
    expect(await state($, 'selected')).toBe('rules')
    expect(it.opened.at(-1)).toEqual({ id: 'headspace', title: 'headspace', closeOnEscape: true, focus: true })
    await ui.unmount()
  })

  test('each kind that holds anything has a Button shown at rest in every width, the keyboard’s way into the pane on it', WITH_PROBE, async ($, on) => {
    const it = session(on)
    quietBand(on)
    await filled($, it)
    await seed($, 'marks', [{ id: 't1', label: 'Read src/data.json (9.9k tokens)' }])
    const KINDS = ['system', 'rules', 'conversation', 'large', 'free', 'reserve']
    const widths: [number, string[], string[]][] = [
      [120, ['label-percent', 'label-system', 'label-rules', 'label-conversation', 'label-large', 'label-marked', 'label-free', 'label-reserve'], ['sys', 'rules 4k', 'conv', 'large ', 'free', 'res']],
      [80, ['label-percent', 'label-system', 'label-rules', 'label-conversation', 'label-large', 'label-marked', 'label-free', 'label-reserve'], ['sys', 'rules', 'conv', 'large', 'free', 'res']],
      [50, ['label-percent', 'label-system', 'label-rules', 'label-conversation', 'label-large', 'label-free', 'label-reserve'], ['s', 'r', 'c', 'l', 'f', 'b']],
    ]
    for (const [columns, keys, labels] of widths) {
      const ui = await band($, 'terminal', columns)
      // ctrl+x tab reaches the Buttons the band shows; the ones under a hover-only Box are the pointer's.
      expect(visibleButtons(await ui.drawn())).toEqual(keys)
      for (const [i, kind] of KINDS.entries()) {
        expect((await ui.find({ key: `label-${kind}` }))?.text.startsWith(labels[i] ?? '?')).toBe(true)
        await command($, 'headspace', kind === 'rules' ? 'free' : 'rules')
        await ui.press({ key: `label-${kind}` })
        await it.clock.settle()
        expect(await state($, 'selected')).toBe(kind)
      }
      for (const [key, kind] of [['label-percent', 'rules'], ...(keys.includes('label-marked') ? [['label-marked', 'large']] : [])]) {
        await command($, 'headspace', 'system')
        await ui.press({ key: key as string })
        await it.clock.settle()
        expect(await state($, 'selected')).toBe(kind)
      }
      // All of it fits the width the band has.
      expect(rowWidth(await ui.drawn())).toBeLessThanOrEqual(columns)
      await ui.unmount()
    }
  })

  test('a kind that holds nothing has no cell and no Button', WITH_PROBE, async ($, on) => {
    const it = session(on)
    quietBand(on)
    it.categories = ROWS
    await endTurn($)
    for (const columns of [120, 80, 50]) {
      const ui = await band($, 'terminal', columns)
      expect(await ui.find({ key: 'label-large' })).toBeUndefined()
      expect(await ui.find({ key: 'label-rules' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('labels and counts follow the bar; the stale line shows with staleCount', WITH_PROBE, async ($, on) => {
    const it = session(on)
    quietBand(on)
    await filled($, it)
    const changes = {
      [ruleId('Never push')]: [{ type: 'off' }],
      // An edit is a change, not a rule turned off: it does not count as off.
      [ruleId('Commit messages')]: [{ type: 'edit', lineIndex: 0, text: '- Commit messages are short.' }],
      'Git#9#00000000': [{ type: 'off' }],
    }
    await seed($, 'applied', [{ source: PROJECT, changes }])
    await context($)
    expect(await state($, 'staleCount')).toBe(1)
    const ui = await band($)
    expect((await ui.find({ key: 'label-rules' }))?.text).toBe('rules 4k')
    expect((await ui.find({ key: 'label-off' }))?.text).toBe('1 off')
    expect((await ui.find({ key: 'label-large' }))?.text).toMatch(/^large (9\.\d|10)k$/)
    expect((await ui.find({ type: 'Text', text: /no longer appl/ }))?.text).toBe('1 change no longer applies')
    expect(await ui.find({ text: /·/ })).toBeUndefined()
    await ui.unmount()
  })

  test('marks count on the bar', WITH_PROBE, async ($, on) => {
    const it = session(on)
    quietBand(on)
    await filled($, it)
    await seed($, 'marks', [{ id: 't1', label: 'Read src/data.json (9.9k tokens)' }])
    const ui = await band($)
    expect((await ui.find({ key: 'label-marked' }))?.text).toBe('1 marked')
    await ui.unmount()
  })

  test('a narrow band drops the labels first, then the counts; the percentage stays', WITH_PROBE, async ($, on) => {
    const it = session(on)
    quietBand(on)
    await filled($, it)
    await seed($, 'marks', [{ id: 't1', label: 'Read src/data.json (9.9k tokens)' }])
    const counts = await band($, 'terminal', 80)
    expect((await counts.find({ key: 'label-rules' }))?.text).toBe('rules')
    expect((await counts.find({ key: 'label-marked' }))?.text).toBe('1 marked')
    expect((await counts.find({ key: 'label-percent' }))?.text).toBe('31%')
    await counts.unmount()
    const bare = await band($, 'terminal', 50)
    expect(await bare.find({ key: 'label-marked' })).toBeUndefined()
    expect((await bare.find({ key: 'label-rules' }))?.text).toBe('r')
    expect((await bare.find({ key: 'label-percent' }))?.text).toBe('31%')
    expect((await bare.findAll({ type: 'Text', text: /^[█░▁]+$/ })).length).toBe(6)
    // No room beside a bare bar for a card.
    expect(await bare.find({ key: 'card-rules' })).toBeUndefined()
    await bare.unmount()
  })

  test('the band yields to a survey', WITH_PROBE, async ($, on) => {
    const it = session(on)
    engineBand(on)
    await filled($, it)
    const ui = await $.ui.mount({ plugin: 'headspace', surface: 'terminal', ...BAND, props: { ...BAND.props, hasSurvey: true } } as never)
    expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
    expect(await ui.find({ key: 'label-percent' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('the pane', () => {
  test('a tab row of the six kinds, the selected one drawn inverse; a tab switches kind', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await filled($, it)
    await command($, 'headspace')
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      const selected = await ui.find({ type: 'Text', text: /^ rules $/ })
      expect(selected?.props).toMatchObject({ inverse: true, color: CLAY })
      expect(await ui.find({ key: 'tab-rules' })).toBeUndefined()
      for (const kind of ['system', 'conversation', 'large', 'free', 'reserve']) {
        expect((await ui.find({ key: `tab-${kind}` }))?.text).toBe(kind)
      }
      await ui.unmount()
    }
    const ui = await pane($)
    await ui.press({ key: 'tab-large' })
    expect(await state($, 'selected')).toBe('large')
    expect(await ui.find({ type: 'Text', text: /^ large $/ })).toBeDefined()
    expect((await ui.find({ key: 'mark-0' }))?.text).toBe('[ ]')
    await ui.press({ key: 'tab-system' })
    expect((await ui.find({ type: 'Text', text: /^System tools/ }))?.text).toBe('System tools  12k')
    expect(await ui.find({ type: 'Text', text: /MCP tools \(deferred\)/ })).toBeUndefined()
    await ui.unmount()
  })

  test('the rules: files, their rows, and the session rules', WITH_PROBE, async ($, on) => {
    const it = session(on)
    paths(on)
    await filled($, it)
    await command($, 'headspace')
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      expect((await ui.find({ type: 'Text', text: /^CLAUDE\.md/ }))?.text).toMatch(/^CLAUDE\.md {2}project {2}\d+$/)
      expect((await ui.find({ type: 'Button', text: /Never push straight to main/ }))?.props.plain).toBe(true)
      expect(await ui.find({ type: 'Text', text: /^session rules/ })).toBeDefined()
      expect((await ui.find({ key: 'apply-rules' }))?.text).toBe('apply')
      // From the first user message on: rules 4k, the conversation and large 10k. The tools and the
      // system prompt come before it and stay cached; free space and the reserve are not sent.
      expect((await ui.find({ type: 'Text', text: /of cache$/ }))?.text).toBe('rewrites ~14k of cache')
      await ui.unmount()
    }
  })

  test('file paths: relative under the session root, ~/ under home, absolute elsewhere, cut from the left', WITH_PROBE, async ($, on) => {
    const it = session(on)
    paths(on)
    it.categories = ROWS
    const files = [
      { path: MANAGED, kind: 'managed', content: MANAGED_TEXT },
      { path: '/home/me/.claude/CLAUDE.md', kind: 'user', content: '- Be brief.\n' },
      { path: PROJECT, kind: 'project', content: PROJECT_TEXT },
      { path: '/repo/docs/rules.md', kind: 'project', content: '- Test first.\n' },
    ]
    const text = files.map(f => `Contents of ${f.path}:\n\n${f.content}`).join('\n\n')
    await $.prompt.context({ blocks: [{ name: 'claudeMd', text }], instructionFiles: files } as never)
    await endTurn($)
    await command($, 'headspace')
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      expect((await ui.find({ type: 'Text', text: /^~\/\.claude\/CLAUDE\.md/ }))?.text).toMatch(/^~\/\.claude\/CLAUDE\.md {2}user {2}\d+$/)
      expect((await ui.find({ type: 'Text', text: /^CLAUDE\.md/ }))?.text).toMatch(/^CLAUDE\.md {2}project {2}\d+$/)
      const rules = await ui.find({ type: 'Text', text: /^docs\/rules\.md/ })
      expect(rules?.text).toMatch(/^docs\/rules\.md {2}project {2}\d+$/)
      // Still too long for the pane, the start goes first: the name and the figures stay.
      expect(rules?.props.wrap).toBe('truncate-start')
      expect((await ui.find({ type: 'Text', text: /^\/etc\/claude\/CLAUDE\.md/ }))?.text).toMatch(/^\/etc\/claude\/CLAUDE\.md {2}managed/)
      expect(await ui.find({ type: 'Text', text: /\/home\/me|\/repo\// })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('a waiting auto-memory change rewrites the system prompt too', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await filled($, it)
    await command($, 'headspace')
    await seed($, 'pending', [{ source: 'memory', changes: { 'Kali#0#00000000': [{ type: 'off' }] } }])
    const ui = await pane($)
    // The memory index rides in the system prompt: system 15k on top of the 14k after it.
    expect((await ui.find({ type: 'Text', text: /of cache$/ }))?.text).toBe('rewrites ~29k of cache')
    await ui.unmount()
  })

  test('turning a rule off and pressing apply changes the next context', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await filled($, it)
    await command($, 'headspace')
    const ui = await pane($)
    const row = await ui.find({ type: 'Button', text: /Never push straight to main/ })
    await ui.press({ key: row!.key! })
    expect(await ui.find({ type: 'Text', text: /^- Never push straight to main\.$/ })).toBeDefined()
    expect((await ui.find({ key: 'toggle' }))?.text).toBe('off')
    await ui.press({ key: 'toggle' })
    expect((await ui.find({ key: 'toggle' }))?.text).toBe('on')
    expect((await ui.findAll({ type: 'Text', text: /^○$/ })).length).toBe(1)
    // Still pending: the context keeps the rule until apply.
    expect((await context($)).blocks[0]?.text).toContain('Never push straight to main')
    await ui.press({ key: 'apply-rules' })
    const text = (await context($)).blocks[0]?.text ?? ''
    expect(text.includes('Never push straight to main')).toBe(false)
    expect(text).toContain('Commit messages follow Conventional Commits.')
    await ui.unmount()
  })

  test('edit and add line write the selected rule’s changes', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await filled($, it)
    await command($, 'headspace')
    const ui = await pane($)
    const row = await ui.find({ type: 'Button', text: /Commit messages/ })
    await ui.press({ key: row!.key! })
    expect((await ui.find({ key: 'edit' }))?.props.value).toBe('- Commit messages follow Conventional Commits.')
    await $.ui.input({ plugin: 'headspace', key: 'edit', text: '- Commit messages are short.' })
    await $.ui.input({ plugin: 'headspace', key: 'add-line', text: '  Use the imperative.' })
    const id = ruleId('Commit messages')
    expect((await state($, 'pending'))[0]).toEqual({
      source: PROJECT,
      changes: {
        [id]: [
          { type: 'edit', lineIndex: 0, text: '- Commit messages are short.' },
          { type: 'addLine', afterLineIndex: 0, text: '  Use the imperative.' },
        ],
      },
    })
    await ui.unmount()
  })

  test('a session rule typed in the field waits for apply, then reaches the context', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await filled($, it)
    await command($, 'headspace')
    const ui = await pane($)
    await $.ui.input({ plugin: 'headspace', key: 'session-rule', text: 'Keep the public API unchanged' })
    expect(await state($, 'pendingSessionRules')).toEqual(['Keep the public API unchanged'])
    expect(await ui.find({ type: 'Text', text: /^Keep the public API unchanged$/ })).toBeDefined()
    await ui.press({ key: 'apply-rules' })
    const blocks = (await context($)).blocks
    expect(blocks.at(-1)).toEqual({ name: 'sessionRules', text: 'Session rules the person set for this session:\n- Keep the public API unchanged' })
    await ui.press({ key: 'session-remove-0' })
    expect(await state($, 'pendingSessionRules')).toEqual([])
    await ui.unmount()
  })

  test('a Managed file shows its rules without buttons, and says managed', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await filled($, it)
    await command($, 'headspace')
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      expect((await ui.find({ type: 'Text', text: /^\/etc\/claude\/CLAUDE\.md/ }))?.text).toMatch(/managed/)
      expect(await ui.find({ type: 'Text', text: /Follow the security policy/ })).toBeDefined()
      expect(await ui.find({ type: 'Button', text: /Follow the security policy/ })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('the large results: rows, view, mark and apply', WITH_PROBE, async ($, on) => {
    const it = session(on)
    const person = answering(on, ['Remove'])
    await filled($, it)
    await command($, 'headspace-cut-ready', 'on')
    await command($, 'headspace', 'large')
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      expect((await ui.find({ type: 'Text', text: /^Read / }))?.text).toMatch(/^Read src\/data\.json {2}(9\.\d|10)k {2}0 turns ago$/)
      await ui.unmount()
    }
    const ui = await pane($)
    await ui.press({ key: 'view-0' })
    expect(await ui.find({ type: 'Text', text: /^first line$/ })).toBeDefined()
    expect((await ui.find({ key: 'apply-cut' }))?.props.dimColor).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^no results marked$/ })).toBeDefined()
    await ui.press({ key: 'mark-0' })
    expect((await ui.find({ key: 'mark-0' }))?.text).toBe('[x]')
    expect((await ui.find({ key: 'apply-cut' }))?.props.dimColor).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^frees / }))?.text).toMatch(/^frees (9\.\d|10)k, rewrites ~(9\.\d|10)k$/)
    await ui.press({ key: 'apply-cut' })
    await it.clock.settle()
    // A removal cannot be undone: the button asks first.
    expect(person.asked.length).toBe(1)
    expect(it.compactions.at(-1)?.startsWith('headspace-cut:')).toBe(true)
    await ui.unmount()
  })

  test('large apply asks first; Cancel sends no compaction and keeps the marks', WITH_PROBE, async ($, on) => {
    const it = session(on)
    const person = answering(on, ['Cancel'])
    await filled($, it)
    await command($, 'headspace-cut-ready', 'on')
    await command($, 'headspace', 'large')
    const ui = await pane($)
    await ui.press({ key: 'mark-0' })
    await ui.press({ key: 'apply-cut' })
    await it.clock.settle()
    expect(person.asked).toEqual([expect.stringMatching(/^Remove 1 result from what Claude reads\? This cannot be undone\. Frees (9\.\d|10)k, rewrites ~(9\.\d|10)k of cache\.$/)])
    expect(it.compactions).toEqual([])
    expect((await ui.find({ key: 'mark-0' }))?.text).toBe('[x]')
    expect((await state($, 'marks')).length).toBe(1)
    await ui.unmount()
  })

  test('large apply is dimmed with its reason while a turn runs, and without headspace-cut', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await filled($, it)
    await command($, 'headspace', 'large')
    await seed($, 'marks', [{ id: 't1', label: 'Read src/data.json (9.9k tokens)' }])
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      expect((await ui.find({ key: 'apply-cut' }))?.props.dimColor).toBe(true)
      expect(await ui.find({ type: 'Text', text: /^install headspace-cut to remove results$/ })).toBeDefined()
      await ui.unmount()
    }
    await command($, 'headspace-cut-ready', 'on')
    await startTurn($)
    const ui = await pane($)
    expect((await ui.find({ key: 'apply-cut' }))?.props.dimColor).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^Claude is working: remove results between turns$/ })).toBeDefined()
    await ui.press({ key: 'apply-cut' })
    await it.clock.settle()
    expect(it.compactions).toEqual([])
    await ui.unmount()
  })

  test('a skipped removal shows its reason under apply and keeps the marks', WITH_PROBE, async ($, on) => {
    const it = session(on)
    answering(on, ['Remove'])
    await filled($, it)
    await command($, 'headspace-cut-ready', 'on')
    await command($, 'headspace', 'large')
    it.compactAnswer = { skip: 'headspace-cut: 1 marked result is no longer in the conversation' }
    const ui = await pane($)
    await ui.press({ key: 'mark-0' })
    await ui.press({ key: 'apply-cut' })
    await it.clock.settle()
    expect(await ui.find({ type: 'Text', text: /^headspace-cut: 1 marked result is no longer in the conversation$/ })).toBeDefined()
    expect((await ui.find({ key: 'mark-0' }))?.text).toBe('[x]')
    await ui.unmount()
  })

  test('headspace losing track says where, on top', WITH_PROBE, async ($, on) => {
    const it = session(on)
    it.categories = ROWS
    it.api = 'not a conversation' as never
    await endTurn($)
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      expect(await ui.find({ type: 'Text', text: /^headspace lost track at turn\.complete$/ })).toBeDefined()
      await ui.unmount()
    }
  })
})
