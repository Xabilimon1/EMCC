import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

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
const LIGHT = '#e8e6dc'

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
    engineBand(on)
    await filled($, it)
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeUndefined()
      const cells = (await ui.findAll({ type: 'Text', text: /^[█░]+$/ })).map(one => [one.text[0], one.props.color, one.props.dimColor === true])
      expect(cells).toEqual([
        ['█', STONE, false],
        ['█', CLAY, false],
        ['█', SKY, false],
        ['█', OLIVE, false],
        ['█', LIGHT, true],
        ['░', STONE, false],
      ])
      expect(await ui.find({ type: 'Text', text: /^31%$/ })).toBeDefined()
      for (const kind of ['system', 'rules', 'conversation', 'large', 'free', 'reserve']) {
        expect(await ui.find({ key: `seg-${kind}` })).toBeDefined()
      }
      await ui.unmount()
    }
  })

  test('a kind of 1 token still draws one cell', WITH_PROBE, async ($, on) => {
    const it = session(on)
    it.categories = ROWS.map(row => (row.name === 'Memory files' ? { ...row, tokens: 1 } : row))
    await endTurn($)
    const ui = await band($)
    const rules = (await ui.findAll({ type: 'Text', text: /^█+$/ })).filter(one => one.props.color === CLAY)
    expect(rules.map(one => one.text)).toEqual(['█'])
    await ui.unmount()
  })

  test('each segment holds its hover card, with what can be done there', WITH_PROBE, async ($, on) => {
    const it = session(on)
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
        const segment = await ui.find({ key: `seg-${kind}` })
        const text = shown(segment)
        expect(text).toContain(action)
        expect(text).toContain(kind)
        const other = action === 'view only' ? 'click to view and remove' : 'view only'
        expect(text.includes(other)).toBe(false)
      }
      const card = (await ui.find({ key: 'seg-rules' }))?.children.find(
        child => typeof child === 'object' && (child as { props?: { position?: string } }).props?.position === 'absolute' && shown(child).includes('rules'),
      ) as { props: Record<string, unknown>; hover?: unknown } | undefined
      expect(card?.props).toMatchObject({ position: 'absolute', top: -3, display: 'none', borderStyle: 'round' })
      expect(card?.hover).toEqual({ display: 'flex' })
      expect(shown(await ui.find({ key: 'seg-rules' }))).toContain('4k')
      expect(shown(await ui.find({ key: 'seg-large' }))).toContain('1 result')
      await ui.unmount()
    }
  })

  test('pressing the rules segment opens the pane on rules', WITH_PROBE, async ($, on) => {
    const it = session(on)
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

  test('labels and counts follow the bar; the stale line shows with staleCount', WITH_PROBE, async ($, on) => {
    const it = session(on)
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
    expect((await ui.find({ type: 'Text', text: /^rules \d/ }))?.text).toBe('rules 4k')
    expect((await ui.find({ type: 'Text', text: /off$/ }))?.text).toBe('1 off')
    expect((await ui.find({ type: 'Text', text: /^large \d/ }))?.text).toMatch(/^large (9\.\d|10)k$/)
    expect((await ui.find({ type: 'Text', text: /no longer appl/ }))?.text).toBe('1 change no longer applies')
    expect(await ui.find({ type: 'Text', text: /·/ })).toBeUndefined()
    await ui.unmount()
  })

  test('marks count on the bar', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await filled($, it)
    await seed($, 'marks', [{ id: 't1', label: 'Read src/data.json (9.9k tokens)' }])
    const ui = await band($)
    expect((await ui.find({ type: 'Text', text: /marked$/ }))?.text).toBe('1 marked')
    await ui.unmount()
  })

  test('a narrow band drops the labels first, then the counts; the percentage stays', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await filled($, it)
    await seed($, 'marks', [{ id: 't1', label: 'Read src/data.json (9.9k tokens)' }])
    const counts = await band($, 'terminal', 80)
    expect(await counts.find({ type: 'Text', text: /^rules \d/ })).toBeUndefined()
    expect((await counts.find({ type: 'Text', text: /marked$/ }))?.text).toBe('1 marked')
    expect(await counts.find({ type: 'Text', text: /^31%$/ })).toBeDefined()
    await counts.unmount()
    const bare = await band($, 'terminal', 50)
    expect(await bare.find({ type: 'Text', text: /marked$/ })).toBeUndefined()
    expect(await bare.find({ type: 'Text', text: /^31%$/ })).toBeDefined()
    expect((await bare.findAll({ type: 'Text', text: /^[█░]+$/ })).length).toBe(6)
    await bare.unmount()
  })

  test('the band yields to a survey', WITH_PROBE, async ($, on) => {
    const it = session(on)
    engineBand(on)
    await filled($, it)
    const ui = await $.ui.mount({ plugin: 'headspace', surface: 'terminal', ...BAND, props: { ...BAND.props, hasSurvey: true } } as never)
    expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
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
    await filled($, it)
    await command($, 'headspace')
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      expect((await ui.find({ type: 'Text', text: /^\/repo\/CLAUDE\.md/ }))?.text).toMatch(/^\/repo\/CLAUDE\.md {2}project {2}\d+$/)
      expect((await ui.find({ type: 'Button', text: /Never push straight to main/ }))?.props.plain).toBe(true)
      expect(await ui.find({ type: 'Text', text: /^session rules/ })).toBeDefined()
      expect((await ui.find({ key: 'apply-rules' }))?.text).toBe('apply')
      // Everything used: system 15k, rules 4k, the conversation and large 10k; never free space or the reserve.
      expect((await ui.find({ type: 'Text', text: /of cache$/ }))?.text).toBe('rewrites ~29k of cache')
      await ui.unmount()
    }
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
    expect(it.compactions.at(-1)?.startsWith('headspace-cut:')).toBe(true)
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
