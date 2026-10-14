import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { cutInstructions } from '../hooks/large'
import { memoryEntries } from '../hooks/memory'
import { hash, parseRules } from '../hooks/rules'
import { probe } from './fixtures/probe'
import { command, endTurn, seed, session, startTurn, state } from './fixtures/session'
import type { Row } from './fixtures/session'

const WITH_PROBE = { plugins: [probe] }

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
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(30000) }] },
    { role: 'assistant', content: [{ type: 'text', text: 'It holds the data.' }] },
  ]
}

describe('the bar', () => {
  test('a turn end builds the snapshot from the breakdown and the live conversation', WITH_PROBE, async ($, on) => {
    const it = session(on)
    it.categories = ROWS
    it.percent = 15
    it.api = conversation()
    await it.clock.advance(5000)
    await endTurn($)
    const snapshot = await state($, 'snapshot')
    expect(snapshot.window).toBe(200_000)
    expect(snapshot.percent).toBe(15)
    expect(snapshot.at).toBe(5000)
    const tokens = Object.fromEntries(snapshot.segments.map((s: { kind: string; tokens: number }) => [s.kind, s.tokens]))
    expect(tokens.system).toBe(15000)
    expect(tokens.rules).toBe(4000)
    expect(tokens.free).toBe(138000)
    expect(tokens.reserve).toBe(33000)
    // The Read is nearly all the characters of Messages, so nearly all of it is large.
    expect(tokens.large).toBeGreaterThan(9900)
    expect(tokens.large + tokens.conversation).toBe(10000)
    expect(await state($, 'lostAt')).toBeNull()
  })

  test('a subagent’s turn end does not refresh', WITH_PROBE, async ($, on) => {
    const it = session(on)
    it.categories = ROWS
    await endTurn($, 'agent-1')
    expect(it.usageCalls).toBe(0)
    expect(await state($, 'snapshot')).toBeNull()
  })

  test('a refresh that fails records where and the turn still ends', WITH_PROBE, async ($, on) => {
    const it = session(on)
    it.categories = ROWS
    it.api = 'not a conversation' as never
    expect(await endTurn($)).toEqual({ text: '' })
    expect(await state($, 'snapshot')).toBeNull()
    expect(await state($, 'lostAt')).toBe('turn.complete')
  })

  test('a later refresh that works clears where headspace lost track', WITH_PROBE, async ($, on) => {
    const it = session(on)
    it.categories = ROWS
    it.api = 'not a conversation' as never
    await endTurn($)
    expect(await state($, 'lostAt')).toBe('turn.complete')
    it.api = conversation()
    await endTurn($)
    expect(await state($, 'snapshot')).not.toBeNull()
    expect(await state($, 'lostAt')).toBeNull()
  })

  test('without a breakdown the snapshot stays null', WITH_PROBE, async ($, on) => {
    const it = session(on)
    it.categories = null
    await endTurn($)
    expect(it.usageCalls).toBe(1)
    expect(await state($, 'snapshot')).toBeNull()
    expect(await state($, 'lostAt')).toBeNull()
  })
})

const PROJECT = '/repo/CLAUDE.md'
const USER = '/home/me/.claude/CLAUDE.md'
const PROJECT_TEXT = '# Git\n\n- Commit messages follow Conventional Commits.\n- Never push straight to main.\n\n# Style\n\n- Two spaces.\n'
const USER_TEXT = '- Answer in English.\n- Never push straight to main.\n'
const FILES = [
  { path: USER, kind: 'user', content: USER_TEXT },
  { path: PROJECT, kind: 'project', content: PROJECT_TEXT },
]
const CLAUDE_MD = `Contents of ${USER} (user's private global instructions):\n\n${USER_TEXT}\n\nContents of ${PROJECT} (project instructions):\n\n${PROJECT_TEXT}`
const BLOCKS = [
  { name: 'claudeMd', text: CLAUDE_MD },
  { name: 'currentDate', text: "Today's date is 2026-10-14." },
]

/** The id of the project rule whose first line holds `words`. */
function ruleId(words: string, text = PROJECT_TEXT): string {
  const rule = parseRules(text).rules.find(r => r.lines[0]?.includes(words))
  if (rule === undefined) {
    throw new Error(`no rule with ${words}`)
  }

  return rule.id
}

/** Core's context, the files behind claudeMd given; `null` leaves them out, as when a hook above rewrote its text. */
function context($: Engine, files: unknown[] | null = FILES) {
  return $.prompt.context((files === null ? { blocks: BLOCKS } : { blocks: BLOCKS, instructionFiles: files }) as never)
}

/** Core's context once the engine read the project file again and found `text` in it. */
function reread($: Engine, text: string) {
  return $.prompt.context({ blocks: [{ name: 'claudeMd', text: CLAUDE_MD.replace(PROJECT_TEXT, text) }, BLOCKS[1]], instructionFiles: [FILES[0], { ...FILES[1], content: text }] } as never)
}

describe('the rules in the context', () => {
  test('nothing applied hands core’s blocks on unchanged', WITH_PROBE, async ($, on) => {
    session(on)
    const r = await context($)
    expect(r.blocks).toEqual(BLOCKS)
    expect(await state($, 'lostAt')).toBeNull()
  })

  test('a rule turned off leaves the claudeMd block without it, and only it', WITH_PROBE, async ($, on) => {
    session(on)
    await seed($, 'applied', [{ source: PROJECT, changes: { [ruleId('Never push')]: [{ type: 'off' }] } }])
    const r = await context($)
    const without = PROJECT_TEXT.replace('- Never push straight to main.\n', '')
    expect(r.blocks).toEqual([{ name: 'claudeMd', text: CLAUDE_MD.replace(PROJECT_TEXT, without) }, BLOCKS[1]])
    // The user file holds the same words and is left alone.
    expect(r.blocks[0]?.text).toContain(`${USER_TEXT}`)
    expect((await state($, 'staleCount')) ?? 0).toBe(0)
    expect(await state($, 'lostAt')).toBeNull()
  })

  test('an edit and an added line reach the block', WITH_PROBE, async ($, on) => {
    session(on)
    await seed($, 'applied', [
      { source: PROJECT, changes: { [ruleId('Two spaces')]: [{ type: 'edit', lineIndex: 0, text: '- Four spaces.' }, { type: 'addLine', afterLineIndex: 0, text: '- Tabs never.' }] } },
    ])
    const r = await context($)
    expect(r.blocks[0]?.text).toBe(CLAUDE_MD.replace('- Two spaces.\n', '- Four spaces.\n- Tabs never.\n'))
  })

  test('a file is found in its own frame, never in an earlier file that quotes its text', WITH_PROBE, async ($, on) => {
    session(on)
    // The user file holds the whole project file, and is framed first.
    const quoting = USER_TEXT + PROJECT_TEXT
    const files = [{ ...FILES[0], content: quoting }, FILES[1]]
    const text = `Contents of ${USER} (user's private global instructions):\n\n${quoting}\n\nContents of ${PROJECT} (project instructions):\n\n${PROJECT_TEXT}`
    await seed($, 'applied', [{ source: PROJECT, changes: { [ruleId('Never push')]: [{ type: 'off' }] } }])
    const r = await $.prompt.context({ blocks: [{ name: 'claudeMd', text }], instructionFiles: files } as never)
    expect(r.blocks[0]?.text).toBe(`Contents of ${USER} (user's private global instructions):\n\n${quoting}\n\nContents of ${PROJECT} (project instructions):\n\n${WITHOUT_NEVER}`)
    expect((await state($, 'staleCount')) ?? 0).toBe(0)
  })

  test('the engine frames each file trimmed: a change to the last file still applies', WITH_PROBE, async ($, on) => {
    session(on)
    const text = `Contents of ${USER} (user's private global instructions):\n\n${USER_TEXT.trim()}\n\nContents of ${PROJECT} (project instructions):\n\n${PROJECT_TEXT.trim()}`
    await seed($, 'applied', [{ source: PROJECT, changes: { [ruleId('Two spaces')]: [{ type: 'off' }] } }])
    const r = await $.prompt.context({ blocks: [{ name: 'claudeMd', text }], instructionFiles: FILES } as never)
    expect(r.blocks[0]?.text).toBe(text.replace('\n\n# Style\n\n- Two spaces.', '\n\n# Style'))
    expect((await state($, 'staleCount')) ?? 0).toBe(0)
  })

  test('a change whose rule the file now reads as the change made it leaves quietly, never as stale', WITH_PROBE, async ($, on) => {
    session(on)
    const two = ruleId('Two spaces')
    await seed($, 'applied', [{ source: PROJECT, changes: { [ruleId('Never push')]: [{ type: 'off' }], [two]: [{ type: 'edit', lineIndex: 0, text: '- Four spaces.' }] } }])
    await context($)
    // Made by hand in the file, the same changes: the rule gone, the line edited.
    const byHand = WITHOUT_NEVER.replace('- Two spaces.', '- Four spaces.')
    await reread($, byHand)
    expect(await state($, 'applied')).toEqual([])
    expect((await state($, 'staleCount')) ?? 0).toBe(0)
  })

  test('a rule turned off and then rewritten by hand still counts stale', WITH_PROBE, async ($, on) => {
    session(on)
    await seed($, 'applied', [{ source: PROJECT, changes: { [ruleId('Never push')]: [{ type: 'off' }] } }])
    await context($)
    await reread($, PROJECT_TEXT.replace('straight', 'directly'))
    expect(await state($, 'applied')).toEqual([])
    expect(await state($, 'staleCount')).toBe(1)
  })

  test('a change whose rule changed on disk is dropped and counted stale', WITH_PROBE, async ($, on) => {
    session(on)
    const gone = ruleId('Never push', PROJECT_TEXT.replace('straight', 'directly'))
    const kept = ruleId('Two spaces')
    await seed($, 'applied', [{ source: PROJECT, changes: { [gone]: [{ type: 'off' }], [kept]: [{ type: 'off' }] } }])
    const r = await context($)
    // The engine frames a file's text trimmed; its rendered text is framed the same way.
    expect(r.blocks[0]?.text).toBe(CLAUDE_MD.replace('\n\n- Two spaces.\n', '\n'))
    expect(await state($, 'staleCount')).toBe(1)
    expect(await state($, 'applied')).toEqual([{ source: PROJECT, changes: { [kept]: [{ type: 'off' }] } }])
    // Counted once: the next read finds nothing stale left.
    await context($)
    expect(await state($, 'staleCount')).toBe(1)
  })

  test('a file whose text the block no longer frames counts all its changes stale and changes nothing', WITH_PROBE, async ($, on) => {
    session(on)
    await seed($, 'applied', [{ source: PROJECT, changes: { [ruleId('Never push')]: [{ type: 'off' }], [ruleId('Two spaces')]: [{ type: 'off' }] } }])
    const r = await $.prompt.context({ blocks: [{ name: 'claudeMd', text: 'something else' }], instructionFiles: FILES } as never)
    expect(r.blocks).toEqual([{ name: 'claudeMd', text: 'something else' }])
    expect(await state($, 'staleCount')).toBe(2)
  })

  test('changes for a file not loaded in this context are kept for later, even when another file’s go stale', WITH_PROBE, async ($, on) => {
    session(on)
    const nested = { source: '/repo/src/CLAUDE.md', changes: { 'x#0#00000000': [{ type: 'off' }] } }
    await seed($, 'applied', [nested])
    const r = await context($)
    expect(r.blocks).toEqual(BLOCKS)
    expect((await state($, 'staleCount')) ?? 0).toBe(0)
    const gone = ruleId('Never push', PROJECT_TEXT.replace('straight', 'directly'))
    await seed($, 'applied', [nested, { source: PROJECT, changes: { [gone]: [{ type: 'off' }] } }])
    await context($)
    expect(await state($, 'staleCount')).toBe(1)
    expect(await state($, 'applied')).toEqual([nested])
  })

  test('session rules add a block of their own, after core’s', WITH_PROBE, async ($, on) => {
    session(on)
    await seed($, 'sessionRules', ['Keep the public API unchanged', 'Answer briefly'])
    const r = await context($)
    expect(r.blocks).toEqual([
      ...BLOCKS,
      { name: 'sessionRules', text: 'Session rules the person set for this session:\n- Keep the public API unchanged\n- Answer briefly' },
    ])
  })

  test('a hook that throws hands core’s blocks on unchanged and records where', WITH_PROBE, async ($, on) => {
    session(on)
    // Not the contract's shape: rendering it throws.
    await seed($, 'applied', [{ source: PROJECT, changes: null }])
    const r = await context($)
    expect(r.blocks).toEqual(BLOCKS)
    expect(await state($, 'lostAt')).toBe('prompt.context')
  })

  test('claudeMd rewritten above headspace: nothing applied, a note left, session rules still added', WITH_PROBE, async ($, on) => {
    session(on)
    await seed($, 'applied', [{ source: PROJECT, changes: { [ruleId('Never push')]: [{ type: 'off' }] } }])
    await seed($, 'sessionRules', ['Answer briefly'])
    const r = await context($, null)
    expect(r.blocks.slice(0, 2)).toEqual(BLOCKS)
    expect(r.blocks[2]?.name).toBe('sessionRules')
    expect(await state($, 'lostAt')).toBe('prompt.context (claudeMd rewritten above headspace)')
  })
})

const MEMORY_SECTION = '# auto memory\n\nHow to use memory: read the index.\n\n- [Kali](kali.md) — VM on the SSD\n- [Numo](numo.md) — the app\n'

describe('the memory section', () => {
  test('an entry turned off leaves the section, the instructions stay', WITH_PROBE, async ($, on) => {
    session(on)
    const kali = memoryEntries(MEMORY_SECTION).find(m => m.title === 'Kali')?.id ?? ''
    await seed($, 'applied', [{ source: 'memory', changes: { [kali]: [{ type: 'off' }] } }])
    const r = await $.prompt.section({ name: 'memory', text: MEMORY_SECTION } as never)
    expect(r.text).toBe(MEMORY_SECTION.replace('- [Kali](kali.md) — VM on the SSD\n', ''))
  })

  test('nothing off hands core’s section on, and other sections are never touched', WITH_PROBE, async ($, on) => {
    session(on)
    expect((await $.prompt.section({ name: 'memory', text: MEMORY_SECTION } as never)).text).toBe(MEMORY_SECTION)
    const kali = memoryEntries(MEMORY_SECTION).find(m => m.title === 'Kali')?.id ?? ''
    await seed($, 'applied', [{ source: 'memory', changes: { [kali]: [{ type: 'off' }] } }])
    expect((await $.prompt.section({ name: 'env_info_simple', text: MEMORY_SECTION } as never)).text).toBe(MEMORY_SECTION)
  })
})

describe('apply', () => {
  test('/headspace apply puts pending in force, rule by rule, and recomputes the context', WITH_PROBE, async ($, on) => {
    const it = session(on)
    const never = ruleId('Never push')
    const two = ruleId('Two spaces')
    const commit = ruleId('Commit messages')
    await seed($, 'applied', [{ source: PROJECT, changes: { [never]: [{ type: 'off' }], [two]: [{ type: 'off' }] } }])
    // Two turned back on (an empty list), Commit turned off, Never left as it was.
    await seed($, 'pending', [{ source: PROJECT, changes: { [two]: [], [commit]: [{ type: 'off' }] } }])
    await seed($, 'pendingSessionRules', ['Answer briefly'])
    expect(await command($, 'headspace', 'apply')).toBe('headspace: applied, from the next request')
    expect(await state($, 'applied')).toEqual([{ source: PROJECT, changes: { [never]: [{ type: 'off' }], [commit]: [{ type: 'off' }] } }])
    expect(await state($, 'pending')).toEqual([])
    expect(await state($, 'sessionRules')).toEqual(['Answer briefly'])
    expect(await state($, 'pendingSessionRules')).toBeNull()
    expect(it.invalidated).toContain('prompt.context')
    expect(it.invalidated).toContain('prompt.section')
    const r = await context($)
    expect(r.blocks[0]?.text).toBe(CLAUDE_MD.replace('- Commit messages follow Conventional Commits.\n- Never push straight to main.\n', ''))
    expect(r.blocks.at(-1)).toEqual({ name: 'sessionRules', text: 'Session rules the person set for this session:\n- Answer briefly' })
  })

  test('apply clears the count of changes that no longer apply', WITH_PROBE, async ($, on) => {
    session(on)
    const gone = ruleId('Never push', PROJECT_TEXT.replace('straight', 'directly'))
    await seed($, 'applied', [{ source: PROJECT, changes: { [gone]: [{ type: 'off' }] } }])
    await context($)
    expect(await state($, 'staleCount')).toBe(1)
    await command($, 'headspace', 'apply')
    expect(await state($, 'staleCount')).toBe(0)
  })

  test('/headspace apply with nothing waiting says so', WITH_PROBE, async ($, on) => {
    session(on)
    expect(await command($, 'headspace', 'apply')).toBe('headspace: nothing to apply')
  })
})

describe('the pane’s command', () => {
  test('a session start registers /headspace', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    expect(it.registered).toEqual([{ name: 'headspace', description: 'Show what Claude carries and take pieces out' }])
  })

  test('/headspace opens the pane on rules and refreshes the bar', WITH_PROBE, async ($, on) => {
    const it = session(on)
    it.categories = ROWS
    // A row of its own: an empty answer reads `headspace:` with nothing after it.
    expect(await command($, 'headspace')).toBe('opened on rules')
    expect(it.opened).toEqual([{ id: 'headspace', title: 'headspace', closeOnEscape: true, focus: true }])
    expect(await state($, 'selected')).toBe('rules')
    expect(it.usageCalls).toBe(1)
    expect(await state($, 'snapshot')).not.toBeNull()
  })

  test('/headspace large opens it on the large results', WITH_PROBE, async ($, on) => {
    const it = session(on)
    expect(await command($, 'headspace', 'large')).toBe('opened on large')
    expect(it.opened.length).toBe(1)
    expect(await state($, 'selected')).toBe('large')
  })

  test('an unknown word opens nothing and says what is understood', WITH_PROBE, async ($, on) => {
    const it = session(on)
    expect(await command($, 'headspace', 'everything')).toContain('/headspace [rules|large')
    expect(it.opened).toEqual([])
  })
})

const MARK = { id: 't1', label: 'Read src/data.json (9.9k tokens)' }

describe('removing large results', () => {
  test('a refresh drops the marks whose result is no longer in the conversation', WITH_PROBE, async ($, on) => {
    const it = session(on)
    it.categories = ROWS
    it.api = conversation()
    await seed($, 'marks', [MARK, { id: 'gone', label: 'Bash ls (3k tokens)' }])
    await endTurn($)
    expect(await state($, 'marks')).toEqual([MARK])
  })

  test('/headspace cut compacts with headspace-cut instructions once the command is answered, then clears the marks', WITH_PROBE, async ($, on) => {
    const it = session(on)
    it.categories = ROWS
    it.api = conversation()
    await command($, 'headspace-cut-ready', 'on')
    await seed($, 'marks', [MARK])
    // Never under the command's own hook (the host refuses a compaction there): only once the clock moves on.
    expect((await $.command.run({ command: 'headspace', args: 'cut' } as never)).text).toBe('removing 1 result')
    expect(it.compactions).toEqual([])
    await it.clock.advance(1)
    expect(it.compactions).toEqual([cutInstructions([MARK])])
    expect(it.compactions[0]?.startsWith('headspace-cut:')).toBe(true)
    expect(await state($, 'marks')).toEqual([])
    expect(await state($, 'isCutting')).toBe(false)
    expect(await state($, 'lostAt')).toBeNull()
    // The bar is read again after the cut.
    expect(it.usageCalls).toBe(1)
  })

  for (const ready of ['never written', 'off']) {
    test(`refused when headspace-cut is not ready (${ready})`, WITH_PROBE, async ($, on) => {
      const it = session(on)
      if (ready === 'off') {
        await command($, 'headspace-cut-ready', 'off')
      }
      await seed($, 'marks', [MARK])
      expect(await command($, 'headspace', 'cut')).toBe('headspace: install headspace-cut to remove results')
      await it.clock.advance(1)
      expect(it.compactions).toEqual([])
    })
  }

  test('refused once headspace-cut’s heartbeat is older than the last turn’s start: it stopped running', WITH_PROBE, async ($, on) => {
    const it = session(on)
    it.categories = ROWS
    it.api = conversation()
    await command($, 'headspace-cut-ready', 'on')
    await command($, 'headspace-cut-seen', '500')
    await seed($, 'marks', [MARK])
    // The turn ran from 8000 to 10000; headspace-cut last ran at 500.
    await it.clock.advance(10_000)
    await endTurn($, undefined, 2000)
    expect(await command($, 'headspace', 'cut')).toBe('headspace: headspace-cut is not running: turn it on to remove results')
    await it.clock.advance(1)
    expect(it.compactions).toEqual([])
  })

  test('accepted when headspace-cut’s heartbeat is from within the last turn, whichever hook ran first', WITH_PROBE, async ($, on) => {
    const it = session(on)
    it.categories = ROWS
    it.api = conversation()
    await command($, 'headspace-cut-ready', 'on')
    // Written as the turn ended, before headspace's own hook read the clock: the turn's start is the bound, not its end.
    await command($, 'headspace-cut-seen', '8000')
    await seed($, 'marks', [MARK])
    await it.clock.advance(10_000)
    await endTurn($, undefined, 2000)
    expect(await command($, 'headspace', 'cut')).toBe('removing 1 result')
    await it.clock.advance(1)
    expect(it.compactions).toEqual([cutInstructions([MARK])])
  })

  test('before the first turn ends, ready is enough', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await command($, 'headspace-cut-ready', 'on')
    await command($, 'headspace-cut-seen', '0')
    await seed($, 'marks', [MARK])
    await it.clock.advance(10_000)
    expect(await command($, 'headspace', 'cut')).toBe('removing 1 result')
  })

  test('/headspace cut refused when its timer fires says why in a toast', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await command($, 'headspace-cut-ready', 'on')
    await seed($, 'marks', [MARK])
    expect((await $.command.run({ command: 'headspace', args: 'cut' } as never)).text).toBe('removing 1 result')
    // A turn starts before the compaction could.
    await $.turn.start({ text: 'go', turnId: 'turn-2' } as never)
    await it.clock.advance(1)
    expect(it.compactions).toEqual([])
    expect(it.toasts).toEqual(['headspace: Claude is working: remove results between turns'])
    expect(await state($, 'marks')).toEqual([MARK])
  })

  test('refused while a turn runs, offered again once it ends', WITH_PROBE, async ($, on) => {
    const it = session(on)
    it.categories = ROWS
    it.api = conversation()
    await command($, 'headspace-cut-ready', 'on')
    await seed($, 'marks', [MARK])
    await startTurn($)
    expect(await command($, 'headspace', 'cut')).toBe('headspace: Claude is working: remove results between turns')
    await it.clock.advance(1)
    expect(it.compactions).toEqual([])
    await endTurn($)
    expect(await command($, 'headspace', 'cut')).toBe('removing 1 result')
  })

  test('refused with nothing marked', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await command($, 'headspace-cut-ready', 'on')
    expect(await command($, 'headspace', 'cut')).toBe('headspace: no results marked')
    await it.clock.advance(1)
    expect(it.compactions).toEqual([])
  })

  test('refused while a cut is in flight', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await command($, 'headspace-cut-ready', 'on')
    await seed($, 'marks', [MARK])
    await seed($, 'isCutting', true)
    expect(await command($, 'headspace', 'cut')).toBe('headspace: a removal is already running')
    await it.clock.advance(1)
    expect(it.compactions).toEqual([])
  })

  test('a skip keeps the marks and shows the reason; it is not a crash', WITH_PROBE, async ($, on) => {
    const it = session(on)
    it.categories = ROWS
    it.api = conversation()
    it.compactAnswer = { skip: 'headspace-cut: 1 marked result is no longer in the conversation' }
    await command($, 'headspace-cut-ready', 'on')
    await seed($, 'marks', [MARK])
    expect(await command($, 'headspace', 'cut')).toBe('removing 1 result')
    await it.clock.advance(1)
    expect(it.compactions.length).toBe(1)
    expect(await state($, 'marks')).toEqual([MARK])
    expect(it.toasts).toEqual(['headspace-cut: 1 marked result is no longer in the conversation'])
    expect(await state($, 'isCutting')).toBe(false)
    expect(await state($, 'lostAt')).toBeNull()
  })
})

// ---------------------------------------------------------------- save and undo

const PANE = {
  component: 'Pane',
  requestId: 'headspace',
  props: { title: 'headspace', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
  viewport: { rows: 80, columns: 100 },
} as const

type Disk = {
  files: Map<string, string>
  /** Every write, in order: path and text. */
  written: [string, string][]
  /** For every write, in order: whether `$.store` already held a backup of that path when it happened. */
  backedUp: boolean[]
  /** The store beneath headspace: what `$.store` holds. */
  store: Map<string, unknown>
  /** Every question asked, in order. */
  asked: string[]
  /** The answers given, one per question, in order; a question past them is dismissed. */
  answers: string[]
  /** Runs once a question is asked, before it is answered: how a test changes the file meanwhile. */
  whileAsking: (() => void) | null
  /** The environment headspace reads. */
  env: Record<string, string>
}

/** The files on disk, the store and the person answering the questions, beneath headspace. */
function disk(on: Parameters<typeof session>[0], files: Record<string, string>, store: Record<string, unknown> = {}): Disk {
  const it: Disk = { files: new Map(Object.entries(files)), written: [], backedUp: [], store: new Map(Object.entries(store)), asked: [], answers: [], whileAsking: null, env: { HOME: '/home/me' } }
  on('session.root', () => ({ value: '/repo' }) as never)
  on('env.get', (_$, e) => ({ value: it.env[(e as unknown as { name: string }).name] }) as never)
  on('fs.exists', (_$, e) => ({ value: it.files.has((e as unknown as { path: string }).path) }) as never)
  on('fs.read', (_$, e) => {
    const text = it.files.get((e as unknown as { path: string }).path)
    if (text === undefined) {
      throw new Error('ENOENT')
    }

    return { value: text } as never
  })
  on('fs.write', (_$, e) => {
    const { path, text } = e as unknown as { path: string; text: string }
    it.backedUp.push(it.store.has(`backup:${path}`))
    it.files.set(path, text)
    it.written.push([path, text])

    return { value: undefined } as never
  })
  on('store.get', (_$, e) => ({ value: it.store.get((e as unknown as { key: string }).key) }) as never)
  on('store.set', (_$, e) => {
    const { key, value } = e as unknown as { key: string; value: unknown }
    it.store.set(key, JSON.parse(JSON.stringify(value)))

    return { value: undefined } as never
  })
  on('store.delete', (_$, e) => {
    it.store.delete((e as unknown as { key: string }).key)

    return { value: undefined } as never
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const [question] = (e as unknown as { questions: { question: string }[] }).questions
    it.asked.push(question?.question ?? '')
    it.whileAsking?.()
    it.whileAsking = null
    const answer = it.answers.shift()
    if (answer === undefined) {
      return { isError: true, result: 'dismissed', text: 'The user dismissed the question' } as never
    }

    return { result: { questions: [question], answers: { [question?.question ?? '']: answer } } } as never
  })

  return it
}

const pane = ($: Engine) => $.ui.mount({ plugin: 'headspace', surface: 'terminal', ...PANE } as never)

/**
 * Presses `key`, then draws the pane again: the outcome line lives with the
 * module and the backups in `$.store`, so headspace asks for the redraw with
 * `$.ui.invalidate('ui.render')`, which the session fixture records and
 * answers itself (it never reaches the engine here).
 */
async function act(ui: Awaited<ReturnType<typeof pane>>, key: string): Promise<void> {
  await ui.press({ key })
  await ui.redraw()
}

/** Every string an element and its children show. */
function shown(element: unknown): string {
  if (typeof element === 'string' || typeof element === 'number') {
    return String(element)
  }
  if (element === null || typeof element !== 'object') {
    return ''
  }
  const { props, children } = element as { props?: { label?: unknown }; children?: unknown[] }

  return (typeof props?.label === 'string' ? props.label : '') + (children ?? []).map(shown).join('')
}

/** The project file is the second group (FILES lists the user's first). */
const PROJECT_SAVE = 'save-1'
const PROJECT_UNDO = 'undo-1'
const BACKUP = `backup:${PROJECT}`
const WITHOUT_NEVER = PROJECT_TEXT.replace('- Never push straight to main.\n', '')

describe('saving rules to the file', () => {
  test('save shows the diff, writes the rendered text, keeps a backup, and keeps the changes in force until the engine reads the file again', WITH_PROBE, async ($, on) => {
    const it = session(on)
    const d = disk(on, { [PROJECT]: PROJECT_TEXT, [USER]: USER_TEXT })
    d.answers = ['Save']
    await it.clock.advance(7000)
    await context($)
    await seed($, 'applied', [{ source: PROJECT, changes: { [ruleId('Never push')]: [{ type: 'off' }] } }])
    const ui = await pane($)
    await act(ui, PROJECT_SAVE)
    expect(d.asked.length).toBe(1)
    expect(d.asked[0]).toContain('- - Never push straight to main.')
    expect(d.asked[0]?.includes('Commit messages')).toBe(false)
    expect(d.asked[0]?.endsWith(`Save these changes to ${PROJECT}?`)).toBe(true)
    expect(d.written).toEqual([[PROJECT, WITHOUT_NEVER]])
    // The backup is kept before the file is written: a write that fails leaves the original to restore.
    expect(d.backedUp).toEqual([true])
    expect(d.store.get(BACKUP)).toEqual({ saves: [{ at: 7000, text: PROJECT_TEXT }] })
    expect(it.invalidated).toContain('prompt.context')
    // What the save wrote is session state, so a reload of headspace keeps it.
    expect(await state($, 'savedFrom')).toEqual({ [PROJECT]: { ids: [ruleId('Never push')], rules: [], loaded: hash(PROJECT_TEXT) } })
    // The engine may still hold the text it read before the save: the rule stays out all the same.
    expect((await context($)).blocks[0]?.text).toBe(CLAUDE_MD.replace(PROJECT_TEXT, WITHOUT_NEVER))
    expect((await state($, 'applied')).length).toBe(1)
    // Once it reads the saved file, the change is in the file and leaves applied quietly, never as stale.
    const reread = CLAUDE_MD.replace(PROJECT_TEXT, WITHOUT_NEVER)
    const r = await $.prompt.context({ blocks: [{ name: 'claudeMd', text: reread }], instructionFiles: [FILES[0], { ...FILES[1], content: WITHOUT_NEVER }] } as never)
    expect(r.blocks).toEqual([{ name: 'claudeMd', text: reread }])
    expect(await state($, 'applied')).toEqual([])
    expect(await state($, 'savedFrom')).toEqual({})
    expect((await state($, 'staleCount')) ?? 0).toBe(0)
    expect(it.invalidated).toContain('ui.render')
    expect(await ui.find({ type: 'Text', text: new RegExp(`^saved to ${PROJECT}$`) })).toBeDefined()
    await ui.unmount()
  })

  test('Cancel, or a dismissed question, writes nothing and keeps the changes', WITH_PROBE, async ($, on) => {
    const it = session(on)
    const d = disk(on, { [PROJECT]: PROJECT_TEXT })
    await context($)
    const applied = [{ source: PROJECT, changes: { [ruleId('Never push')]: [{ type: 'off' }] } }]
    await seed($, 'applied', applied)
    const ui = await pane($)
    d.answers = ['Cancel']
    await act(ui, PROJECT_SAVE)
    await act(ui, PROJECT_SAVE)
    expect(d.asked.length).toBe(2)
    expect(d.written).toEqual([])
    expect(d.store.has(BACKUP)).toBe(false)
    expect(await state($, 'applied')).toEqual(applied)
    expect(it.invalidated.includes('prompt.context')).toBe(false)
    expect(await ui.find({ type: 'Text', text: /^nothing written$/ })).toBeDefined()
    await ui.unmount()
  })

  test('a file changed on disk while the person was asked is not written', WITH_PROBE, async ($, on) => {
    session(on)
    const d = disk(on, { [PROJECT]: PROJECT_TEXT })
    d.answers = ['Save']
    d.whileAsking = () => d.files.set(PROJECT, PROJECT_TEXT + '- Someone else wrote this.\n')
    await context($)
    await seed($, 'applied', [{ source: PROJECT, changes: { [ruleId('Never push')]: [{ type: 'off' }] } }])
    const ui = await pane($)
    await act(ui, PROJECT_SAVE)
    expect(d.written).toEqual([])
    expect(d.store.has(BACKUP)).toBe(false)
    expect(await ui.find({ type: 'Text', text: /^changed on disk, nothing written$/ })).toBeDefined()
    await ui.unmount()
  })

  test('a change whose rule differs on disk is not saved, and the pane says how many', WITH_PROBE, async ($, on) => {
    session(on)
    const onDisk = PROJECT_TEXT.replace('Two spaces.', 'Two spaces, always.')
    const d = disk(on, { [PROJECT]: onDisk })
    d.answers = ['Save']
    await context($)
    const two = { [ruleId('Two spaces')]: [{ type: 'off' }] }
    // Put in force the way the pane does (pending, then apply): a seeded `applied` would hide what the save keeps.
    await seed($, 'pending', [{ source: PROJECT, changes: { [ruleId('Never push')]: [{ type: 'off' }], ...two } }])
    await command($, 'headspace', 'apply')
    const ui = await pane($)
    await act(ui, PROJECT_SAVE)
    expect(d.written).toEqual([[PROJECT, onDisk.replace('- Never push straight to main.\n', '')]])
    expect(await ui.find({ type: 'Text', text: /1 change cannot be saved: the rule differs on disk$/ })).toBeDefined()
    // The engine reads the saved file again (its text without what it strips, as before): the saved change
    // leaves applied, and the one that could not be saved stays in force for this session.
    const reread = CLAUDE_MD.replace(PROJECT_TEXT, WITHOUT_NEVER)
    const r = await $.prompt.context({ blocks: [{ name: 'claudeMd', text: reread }], instructionFiles: [FILES[0], { ...FILES[1], content: WITHOUT_NEVER }] } as never)
    expect(r.blocks).toEqual([{ name: 'claudeMd', text: reread.replace('\n\n- Two spaces.\n', '\n') }])
    expect(await state($, 'applied')).toEqual([{ source: PROJECT, changes: two }])
    expect((await state($, 'staleCount')) ?? 0).toBe(0)
    await ui.unmount()
  })

  test('undo save asks, restores the newest backup and uses it up, so a second undo never redoes', WITH_PROBE, async ($, on) => {
    session(on)
    const d = disk(on, { [PROJECT]: PROJECT_TEXT })
    await context($)
    let ui = await pane($)
    expect(await ui.find({ key: PROJECT_UNDO })).toBeUndefined()
    await ui.unmount()
    await seed($, 'applied', [{ source: PROJECT, changes: { [ruleId('Never push')]: [{ type: 'off' }] } }])
    ui = await pane($)
    d.answers = ['Save', 'Cancel', 'Restore']
    await act(ui, PROJECT_SAVE)
    expect(d.files.get(PROJECT)).toBe(WITHOUT_NEVER)
    expect((await ui.find({ key: PROJECT_UNDO }))?.text).toBe('undo save')
    await act(ui, PROJECT_UNDO)
    expect(d.files.get(PROJECT)).toBe(WITHOUT_NEVER)
    await act(ui, PROJECT_UNDO)
    expect(d.asked[2]).toContain('+ - Never push straight to main.')
    expect(d.asked[2]?.endsWith(`Restore ${PROJECT} to how it was before the last save?`)).toBe(true)
    expect(d.files.get(PROJECT)).toBe(PROJECT_TEXT)
    // The restored save is used up, and the text it wrote over is not kept as a save: nothing left to undo.
    expect(d.store.get(BACKUP)).toEqual({ saves: [] })
    expect(d.backedUp).toEqual([true, true])
    expect(await ui.find({ key: PROJECT_UNDO })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: new RegExp(`^restored ${PROJECT}$`) })).toBeDefined()
    await ui.unmount()
  })

  test('after an undo, the change it took out of the file is still in force and can be saved again', WITH_PROBE, async ($, on) => {
    session(on)
    const d = disk(on, { [PROJECT]: PROJECT_TEXT })
    await context($)
    await seed($, 'applied', [{ source: PROJECT, changes: { [ruleId('Never push')]: [{ type: 'off' }] } }])
    const ui = await pane($)
    d.answers = ['Save', 'Restore', 'Save']
    await act(ui, PROJECT_SAVE)
    await act(ui, PROJECT_UNDO)
    expect(d.files.get(PROJECT)).toBe(PROJECT_TEXT)
    // The rule stays out of what Claude reads, as before the save.
    expect((await context($)).blocks[0]?.text).toBe(CLAUDE_MD.replace(PROJECT_TEXT, WITHOUT_NEVER))
    await act(ui, PROJECT_SAVE)
    expect(d.files.get(PROJECT)).toBe(WITHOUT_NEVER)
    expect(d.written.length).toBe(3)
    await ui.unmount()
  })

  test('the backups keep the last ten saves, newest last', WITH_PROBE, async ($, on) => {
    const it = session(on)
    const old = Array.from({ length: 10 }, (_, i) => ({ at: i, text: `save ${i}` }))
    const d = disk(on, { [PROJECT]: PROJECT_TEXT }, { [BACKUP]: { saves: old } })
    d.answers = ['Save']
    await it.clock.advance(50)
    await context($)
    await seed($, 'applied', [{ source: PROJECT, changes: { [ruleId('Never push')]: [{ type: 'off' }] } }])
    const ui = await pane($)
    await act(ui, PROJECT_SAVE)
    expect(d.store.get(BACKUP)).toEqual({ saves: [...old.slice(1), { at: 50, text: PROJECT_TEXT }] })
    await ui.unmount()
  })

  test('a Managed file offers no save and no undo', WITH_PROBE, async ($, on) => {
    session(on)
    const managed = '/etc/claude/CLAUDE.md'
    disk(on, { [managed]: '- Follow the policy.\n' }, { [`backup:${managed}`]: { saves: [{ at: 0, text: '' }] } })
    await $.prompt.context({ blocks: BLOCKS, instructionFiles: [{ path: managed, kind: 'managed', content: '- Follow the policy.\n' }, ...FILES] } as never)
    const ui = await pane($)
    expect(await ui.find({ key: 'save-0' })).toBeUndefined()
    expect(await ui.find({ key: 'undo-0' })).toBeUndefined()
    expect((await ui.find({ key: 'save-1' }))?.text).toBe('save')
    await ui.unmount()
  })
})

describe('a Managed file is never written', () => {
  test('save refuses a file that became Managed after the pane was drawn', WITH_PROBE, async ($, on) => {
    const it = session(on)
    const d = disk(on, { [PROJECT]: PROJECT_TEXT })
    d.answers = ['Save']
    await context($)
    await seed($, 'applied', [{ source: PROJECT, changes: { [ruleId('Never push')]: [{ type: 'off' }] } }])
    const ui = await pane($)
    // The engine now reads the same path as an organization's file; the drawing still holds its save button.
    await context($, [FILES[0], { ...FILES[1], kind: 'managed' }])
    await ui.press({ key: PROJECT_SAVE })
    expect(d.asked).toEqual([])
    expect(d.written).toEqual([])
    expect(d.store.has(BACKUP)).toBe(false)
    expect(it.toasts).toEqual(['managed files are read-only'])
    await ui.unmount()
  })
})

describe('saving a session rule', () => {
  test('into the project CLAUDE.md: the heading made once at the end, each rule appended under it', WITH_PROBE, async ($, on) => {
    session(on)
    const d = disk(on, { [PROJECT]: PROJECT_TEXT })
    await context($)
    await seed($, 'sessionRules', ['Keep the public API unchanged', 'Answer briefly'])
    const ui = await pane($)
    d.answers = ['Project', 'Save']
    await act(ui, 'session-save-0')
    expect(d.asked[0]).toBe('Save this rule to which CLAUDE.md?')
    expect(d.asked[1]).toContain('+ - Keep the public API unchanged')
    expect(d.asked[1]?.endsWith(`Save these changes to ${PROJECT}?`)).toBe(true)
    expect(d.files.get(PROJECT)).toBe(PROJECT_TEXT + '\n## Session rules\n\n- Keep the public API unchanged\n')
    expect(d.store.get(BACKUP)).toEqual({ saves: [{ at: 0, text: PROJECT_TEXT }] })
    // Saved, it is no longer a session rule: what was the second is now the first.
    d.answers = ['Project', 'Save']
    await act(ui, 'session-save-0')
    expect(d.files.get(PROJECT)).toBe(PROJECT_TEXT + '\n## Session rules\n\n- Keep the public API unchanged\n- Answer briefly\n')
    await ui.unmount()
  })

  test('a saved session rule leaves the session rules; Claude reads it once, from the block until the engine reads the file', WITH_PROBE, async ($, on) => {
    const it = session(on)
    const d = disk(on, { [PROJECT]: PROJECT_TEXT })
    await context($)
    await seed($, 'sessionRules', ['Keep the public API unchanged', 'Answer briefly'])
    await seed($, 'pendingSessionRules', ['Keep the public API unchanged', 'Answer briefly', 'Waiting'])
    const ui = await pane($)
    d.answers = ['Project', 'Save']
    await act(ui, 'session-save-0')
    expect(await state($, 'sessionRules')).toEqual(['Answer briefly'])
    expect(await state($, 'pendingSessionRules')).toEqual(['Answer briefly', 'Waiting'])
    expect(it.invalidated).toContain('prompt.context')
    // The engine still hands the file as it read it: the rule rides in the block, once.
    const block = (r: { blocks: readonly { name: string; text: string }[] }) => r.blocks.find(b => b.name === 'sessionRules')?.text
    expect(block(await context($))).toBe('Session rules the person set for this session:\n- Answer briefly\n- Keep the public API unchanged')
    // Typed again as a session rule meanwhile, it is still read once.
    await seed($, 'sessionRules', ['Answer briefly', 'Keep the public API unchanged'])
    expect(block(await context($))).toBe('Session rules the person set for this session:\n- Answer briefly\n- Keep the public API unchanged')
    await seed($, 'sessionRules', ['Answer briefly'])
    // Once it reads the saved file, the rule is in the file alone.
    const saved = d.files.get(PROJECT) ?? ''
    expect(block(await context($, [FILES[0], { ...FILES[1], content: saved }]))).toBe('Session rules the person set for this session:\n- Answer briefly')
    expect(await state($, 'savedFrom')).toEqual({})
    await ui.unmount()
  })

  test('undoing the save that wrote a session rule puts it back among the session rules', WITH_PROBE, async ($, on) => {
    session(on)
    const d = disk(on, { [PROJECT]: PROJECT_TEXT })
    await context($)
    await seed($, 'sessionRules', ['Keep the public API unchanged'])
    const ui = await pane($)
    d.answers = ['Project', 'Save', 'Restore']
    await act(ui, 'session-save-0')
    expect(await state($, 'sessionRules')).toEqual([])
    await act(ui, PROJECT_UNDO)
    expect(d.files.get(PROJECT)).toBe(PROJECT_TEXT)
    expect(await state($, 'sessionRules')).toEqual(['Keep the public API unchanged'])
    expect(await state($, 'savedFrom')).toEqual({})
    await ui.unmount()
  })

  test('under a heading already there, before the next section', WITH_PROBE, async ($, on) => {
    session(on)
    const text = '## Session rules\n\n- Old rule\n\n# Style\n\n- Two spaces.\n'
    const d = disk(on, { [PROJECT]: text })
    await seed($, 'sessionRules', ['Answer briefly'])
    const ui = await pane($)
    d.answers = ['Project', 'Save']
    await act(ui, 'session-save-0')
    expect(d.files.get(PROJECT)).toBe('## Session rules\n\n- Old rule\n- Answer briefly\n\n# Style\n\n- Two spaces.\n')
    await ui.unmount()
  })

  test('into the user CLAUDE.md, made when missing; Cancel at either question writes nothing', WITH_PROBE, async ($, on) => {
    session(on)
    const d = disk(on, {})
    await seed($, 'sessionRules', ['Answer briefly'])
    const ui = await pane($)
    d.answers = ['Cancel']
    await act(ui, 'session-save-0')
    d.answers = ['User', 'Cancel']
    await act(ui, 'session-save-0')
    expect(d.written).toEqual([])
    d.answers = ['User', 'Save']
    await act(ui, 'session-save-0')
    expect(d.written).toEqual([[USER, '## Session rules\n\n- Answer briefly\n']])
    expect(d.store.get(`backup:${USER}`)).toEqual({ saves: [{ at: 0, text: '' }] })
    expect(shown(await ui.find({ type: 'Text', text: new RegExp(`^saved to ${USER}$`) }))).toBe(`saved to ${USER}`)
    await ui.unmount()
  })

  test('the user CLAUDE.md follows CLAUDE_CONFIG_DIR; without it or HOME nothing is written', WITH_PROBE, async ($, on) => {
    session(on)
    const d = disk(on, {})
    d.env = { HOME: '/home/me', CLAUDE_CONFIG_DIR: '/cfg' }
    await seed($, 'sessionRules', ['Answer briefly', 'Keep it short'])
    const ui = await pane($)
    d.answers = ['User', 'Save']
    await act(ui, 'session-save-0')
    expect(d.written.map(([path]) => path)).toEqual(['/cfg/CLAUDE.md'])
    d.env = {}
    d.answers = ['User', 'Save']
    await act(ui, 'session-save-0')
    expect(d.written.length).toBe(1)
    expect(await ui.find({ type: 'Text', text: /^cannot find your CLAUDE\.md: HOME is not set$/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('save with nothing to do, or a file it cannot read', () => {
  test('nothing applied: no question, nothing written', WITH_PROBE, async ($, on) => {
    session(on)
    const d = disk(on, { [PROJECT]: PROJECT_TEXT })
    await context($)
    const ui = await pane($)
    await act(ui, PROJECT_SAVE)
    expect(d.asked).toEqual([])
    expect(d.written).toEqual([])
    expect(await ui.find({ type: 'Text', text: /^nothing applied to save$/ })).toBeDefined()
    await ui.unmount()
  })

  test('only changes that differ on disk: no question, the pane says how many', WITH_PROBE, async ($, on) => {
    session(on)
    const d = disk(on, { [PROJECT]: PROJECT_TEXT.replace('Two spaces.', 'Two spaces, always.') })
    await context($)
    await seed($, 'applied', [{ source: PROJECT, changes: { [ruleId('Two spaces')]: [{ type: 'off' }] } }])
    const ui = await pane($)
    await act(ui, PROJECT_SAVE)
    expect(d.asked).toEqual([])
    expect(d.written).toEqual([])
    expect(await ui.find({ type: 'Text', text: /^1 change cannot be saved: the rule differs on disk$/ })).toBeDefined()
    await ui.unmount()
  })

  test('a file it cannot read: nothing written, the reason shown, nothing lost', WITH_PROBE, async ($, on) => {
    session(on)
    const d = disk(on, {})
    await context($)
    await seed($, 'applied', [{ source: PROJECT, changes: { [ruleId('Never push')]: [{ type: 'off' }] } }])
    const ui = await pane($)
    await act(ui, PROJECT_SAVE)
    expect(d.written).toEqual([])
    expect(await ui.find({ type: 'Text', text: /^nothing written: \S/ })).toBeDefined()
    expect(await state($, 'lostAt')).toBeNull()
    await ui.unmount()
  })
})

describe('undo and line ends', () => {
  test('undo with older saves restores the newest and keeps the rest; a second undo goes further back', WITH_PROBE, async ($, on) => {
    session(on)
    const older = [{ at: 1, text: 'first\n' }, { at: 2, text: 'second\n' }]
    const d = disk(on, { [PROJECT]: PROJECT_TEXT }, { [BACKUP]: { saves: older } })
    await context($)
    const ui = await pane($)
    d.answers = ['Restore', 'Restore']
    await act(ui, PROJECT_UNDO)
    expect(d.files.get(PROJECT)).toBe('second\n')
    expect(d.store.get(BACKUP)).toEqual({ saves: [older[0]] })
    expect((await ui.find({ key: PROJECT_UNDO }))?.text).toBe('undo save')
    await act(ui, PROJECT_UNDO)
    expect(d.files.get(PROJECT)).toBe('first\n')
    expect(d.store.get(BACKUP)).toEqual({ saves: [] })
    await ui.unmount()
  })

  test('a file changed by hand while undo asked is not written, and its backups stay', WITH_PROBE, async ($, on) => {
    session(on)
    const older = [{ at: 1, text: 'first\n' }]
    const d = disk(on, { [PROJECT]: PROJECT_TEXT }, { [BACKUP]: { saves: older } })
    d.answers = ['Restore']
    d.whileAsking = () => d.files.set(PROJECT, PROJECT_TEXT + '- A hand edit.\n')
    await context($)
    const ui = await pane($)
    await act(ui, PROJECT_UNDO)
    expect(d.written).toEqual([])
    expect(d.files.get(PROJECT)).toBe(PROJECT_TEXT + '- A hand edit.\n')
    expect(d.store.get(BACKUP)).toEqual({ saves: older })
    expect(await ui.find({ type: 'Text', text: /^changed on disk, nothing written$/ })).toBeDefined()
    await ui.unmount()
  })

  test('a session rule saved into a CRLF file keeps its line ends', WITH_PROBE, async ($, on) => {
    session(on)
    const d = disk(on, { [PROJECT]: '# Git\r\n\r\n- One.\r\n' })
    await seed($, 'sessionRules', ['Answer briefly'])
    const ui = await pane($)
    d.answers = ['Project', 'Save']
    await act(ui, 'session-save-0')
    expect(d.files.get(PROJECT)).toBe('# Git\r\n\r\n- One.\r\n\r\n## Session rules\r\n\r\n- Answer briefly\r\n')
    await ui.unmount()
  })
})
