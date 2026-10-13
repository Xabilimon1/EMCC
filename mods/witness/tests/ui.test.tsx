import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { emcc } from './fixtures/emcc'
import { probe } from './fixtures/probe'
import { call, command, prompt, session, state } from './fixtures/session'
import type { Session } from './fixtures/session'

const SURFACES = ['terminal', 'desktop'] as const
const OLIVE = '#788c5d'
const CLAY = '#d97757'
const STONE = '#b0aea5'
const WITH_EMCC = { plugins: [emcc, probe] }
const WITH_PROBE = { plugins: [probe] }

const PANE = {
  component: 'Pane',
  requestId: 'witness',
  props: { title: 'witness', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  viewport: { rows: 60, columns: 60 },
} as const

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100 },
} as const

const EDIT = (file: string) => ({ tool: 'Edit', file_path: file, old_string: 'a\n', new_string: 'b\n' })

const pane = ($: Engine, surface: (typeof SURFACES)[number] = 'terminal') => $.ui.mount({ plugin: 'witness', surface, ...PANE } as never)
const band = ($: Engine, surface: (typeof SURFACES)[number] = 'terminal') => $.ui.mount({ plugin: 'witness', surface, ...BAND } as never)

/** The pane closing, as the person closes it with Esc or its close mark (see the probe). */
const closeByHand = ($: Engine) => command($, 'witness-close', 'witness')

/** The engine's own band beneath witness: shows when witness passes. */
function engineBand(on: Parameters<typeof session>[0]): void {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine band</Text>
  })
}

/**
 * Four steps: proven, unproven, flagged, pending. Every `call` moves the clock
 * 1 s first: `npm test` ends at 4 s and the check is recorded then; the
 * thirteenth and last call ends at 13 s, so the proof is 9 s old.
 */
async function fourSteps($: Engine, it: Session): Promise<void> {
  await prompt($, 'Fix the cart.')
  await call($, it, { tool: 'TaskCreate', subject: 'Fix withTax', description: 'x' })
  await call($, it, { tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
  await call($, it, EDIT('/repo/src/cart.js'))
  await call($, it, { tool: 'Bash', command: 'npm test' })
  await command($, 'emcc-check', 'pass npm test')
  await call($, it, { tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await call($, it, { tool: 'TaskCreate', subject: 'Tidy names', description: 'x' })
  await call($, it, { tool: 'TaskUpdate', taskId: '2', status: 'in_progress' })
  await call($, it, EDIT('/repo/src/util.js'))
  await call($, it, { tool: 'TaskUpdate', taskId: '2', status: 'completed' })
  await call($, it, { tool: 'TaskCreate', subject: 'Keep the old test', description: 'x' })
  await call($, it, { tool: 'TaskUpdate', taskId: '3', status: 'in_progress' })
  await command($, 'emcc-flag', 'changes the values in 1 assertion (let through and reported)')
  await call($, it, { tool: 'TaskUpdate', taskId: '3', status: 'completed' })
  await call($, it, { tool: 'TaskCreate', subject: 'Write the changelog', description: 'x' })
}

describe('the pane', () => {
  test('shows the goal, the ribbon, Now and each step with its mark, on both surfaces', WITH_EMCC, async ($, on) => {
    const it = session(on)
    await fourSteps($, it)
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      expect(await ui.find({ type: 'Text', text: /Fix the cart\./ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /█/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /░/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /^implement/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^debug/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /Now idle/ })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: /npm test passed/ }))?.text).toBe('npm test passed 9s ago')
      expect(await ui.find({ type: 'Text', text: /^no proof$/ })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: /changes the values in 1 assertion/ }))?.text).toBe(
        'changes the values in 1 assertion (let through and reported)',
      )
      expect(await ui.find({ type: 'Text', text: /^Write the changelog$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /install emcc-core/ })).toBeUndefined()
      expect((await ui.find({ key: 'pause' }))?.text).toBe('Pause')
      const glyphs = (await ui.findAll({ type: 'Text', text: /^[✓○◌▲·]$/ })).map(one => [one.text, one.props.color])
      expect(glyphs).toEqual([
        ['✓', OLIVE],
        ['○', STONE],
        ['▲', CLAY],
        ['·', STONE],
      ])
      await ui.unmount()
    }
  })

  test('the time under each phase is its running total, in seconds then minutes', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' }, 2000)
    await call($, it, EDIT('/repo/a.js'), 61000)
    const ui = await pane($)
    expect((await ui.find({ type: 'Text', text: /^explore/ }))?.text).toBe('explore 2s')
    expect((await ui.find({ type: 'Text', text: /^implement/ }))?.text).toBe('implement 1m')
    await ui.unmount()
  })

  test('past the ribbon’s cap the totals stay true, though the oldest stretches merge', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    // 204 stretches, alternating: past the cap of 200 the oldest merge, into the first one's phase.
    for (let round = 0; round < 102; round += 1) {
      await call($, it, { tool: 'Read', file_path: '/repo/a.js' }, 500)
      await call($, it, EDIT('/repo/a.js'), 500)
    }
    expect(((await state($, 'segments')) as unknown[]).length).toBe(200)
    const ui = await pane($)
    expect((await ui.find({ type: 'Text', text: /^explore/ }))?.text).toBe('explore 51s')
    expect((await ui.find({ type: 'Text', text: /^implement/ }))?.text).toBe('implement 51s')
    await ui.unmount()
  })

  test('an edit after the proof turns it stale', WITH_EMCC, async ($, on) => {
    const it = session(on)
    await fourSteps($, it)
    await call($, it, EDIT('/repo/src/cart.js'))
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /^proven before 1 edit$/ })).toBeDefined()
    await ui.unmount()
  })

  test('Now names the action in progress', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    const running = $.tool.call({ tool: 'Read', file_path: '/repo/src/cart.js', holdMs: 1000 } as never)
    await it.clock.settle()
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /^reads src\/cart\.js$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Now idle/ })).toBeUndefined()
    await ui.unmount()
    await it.clock.advance(1000)
    await running
  })

  test('criteria come first; one without a command is ticked with its own number key', WITH_EMCC, async ($, on) => {
    const it = session(on)
    await command($, 'goal', 'fix the cart; done when `npm test` passes; README updated')
    await call($, it, { tool: 'Bash', command: 'npm test' })
    await call($, it, { tool: 'TaskCreate', subject: 'Fix withTax', description: 'x' })
    const ui = await pane($)
    const rows = (await ui.findAll({ type: 'Text', text: /^(`npm test` passes|README updated|Fix withTax)$/ })).map(one => one.text)
    expect(rows).toEqual(['`npm test` passes', 'README updated', 'Fix withTax'])
    expect((await ui.find({ type: 'Text', text: /^passed/ }))?.text).toBe('passed 1s ago')
    expect(await ui.find({ key: 'tick-1' })).toBeUndefined()
    expect((await ui.find({ key: 'tick-2' }))?.text).toBe('Done')
    expect((await ui.find({ key: 'tick-2' }))?.props.hotkey).toBe('2')
    await ui.press({ key: 'tick-2' })
    expect((await ui.find({ key: 'tick-2' }))?.text).toBe('Undo')
    expect(((await state($, 'criteria')) as { isTicked: boolean }[]).map(one => one.isTicked)).toEqual([false, true])
    await ui.press({ key: 'tick-2' })
    expect((await ui.find({ key: 'tick-2' }))?.text).toBe('Done')
    await ui.unmount()
  })

  test('a criterion proven over a lowered bar shows the flag', WITH_EMCC, async ($, on) => {
    const it = session(on)
    await command($, 'goal', 'fix the cart; done when `npm test` passes')
    await command($, 'emcc-flag', 'skips 2 tests')
    await call($, it, { tool: 'Bash', command: 'npm test' })
    const ui = await pane($)
    expect((await ui.find({ type: 'Text', text: /^[✓▲]$/ }))?.text).toBe('▲')
    expect(await ui.find({ type: 'Text', text: /^skips 2 tests$/ })).toBeDefined()
    await ui.unmount()
  })

  test('a failing criterion and a stale one say so', WITH_EMCC, async ($, on) => {
    const it = session(on)
    await command($, 'goal', 'fix the cart; done when `npm test` passes; `tsc` passes')
    await call($, it, { tool: 'Bash', command: 'tsc' })
    it.failing.add('npm test')
    await call($, it, { tool: 'Bash', command: 'npm test' })
    await call($, it, EDIT('/repo/a.js'))
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /^failed 1s ago$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^proven before 1 edit$/ })).toBeDefined()
    await ui.unmount()
  })

  test('without emcc-core it shows what it saw and says proof needs emcc-core', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix the cart.')
    await call($, it, { tool: 'TaskCreate', subject: 'Fix withTax', description: 'x' })
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      expect(await ui.find({ type: 'Text', text: /install emcc-core to see proof/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Fix withTax$/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('before anything happened it says what will show up', WITH_PROBE, async ($, on) => {
    session(on)
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /^waiting for a prompt$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^No steps yet/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /░/ })).toBeDefined()
    await ui.unmount()
  })

  test('witness losing track says where', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await command($, 'witness-break', 'hasOpened')
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /^witness lost track at tool\.call$/ })).toBeDefined()
    await ui.unmount()
  })

  test('Pause stops recording at once, and Resume starts the ribbon again from then', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    const ui = await pane($)
    expect((await ui.find({ key: 'pause' }))?.props.hotkey).toBe('p')
    const running = $.tool.call({ tool: 'Read', file_path: '/repo/b.js', holdMs: 1000 } as never)
    await it.clock.settle()
    await ui.press({ key: 'pause' })
    expect(await state($, 'isPaused')).toBe(true)
    // Now clears at once, as `/live pause` clears it.
    expect(await state($, 'now')).toBeNull()
    expect((await ui.find({ key: 'pause' }))?.text).toBe('Resume')
    await it.clock.advance(1000)
    await running
    await it.clock.advance(2000)
    await ui.press({ key: 'pause' })
    await it.clock.settle()
    expect(await state($, 'isPaused')).toBe(false)
    expect((await ui.find({ key: 'pause' }))?.text).toBe('Pause')
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    // 1 s before the pause and 1 s after the resume; the 3 s paused belong to no phase.
    expect(await state($, 'totals')).toEqual({ explore: 2000 })
    await ui.unmount()
  })
})

describe('when the pane is not placed', () => {
  test('without emcc-core, a line above the prompt counts what is proven, with a Live button', WITH_PROBE, async ($, on) => {
    const it = session(on)
    engineBand(on)
    it.isWide = false
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      // Nothing seen yet: the band is the engine's.
      expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
      await ui.unmount()
    }
    await call($, it, { tool: 'TaskCreate', subject: 'Fix withTax', description: 'x' })
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect((await ui.find({ type: 'Text', text: /proven/ }))?.text).toBe('0/1 proven ')
      expect((await ui.find({ key: 'live' }))?.text).toBe('Live')
      expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeUndefined()
      await ui.unmount()
    }
    // A press is the person asking: the engine places the pane at any width (here, the band drawn narrow, then wide).
    const ui = await band($)
    it.isWide = true
    await ui.press({ key: 'live' })
    await it.clock.settle()
    expect(it.opened.at(-1)).toEqual({ id: 'witness', title: 'witness', focus: true, closeOnEscape: true })
    expect(await state($, 'isPlaced')).toBe(true)
    await ui.unmount()
    const after = await band($)
    expect(await after.find({ type: 'Text', text: /engine band/ })).toBeDefined()
    await after.unmount()
  })

  test('a survey keeps the band', WITH_PROBE, async ($, on) => {
    const it = session(on)
    engineBand(on)
    it.isWide = false
    await call($, it, { tool: 'TaskCreate', subject: 'Fix withTax', description: 'x' })
    const ui = await $.ui.mount({ plugin: 'witness', surface: 'terminal', ...BAND, props: { ...BAND.props, hasSurvey: true } } as never)
    expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
    await ui.unmount()
  })

  test('with emcc-core it posts a badge instead, and removes it once the pane is placed', WITH_EMCC, async ($, on) => {
    const it = session(on)
    engineBand(on)
    it.isWide = false
    await call($, it, { tool: 'TaskCreate', subject: 'Fix withTax', description: 'x' })
    const badges = () => command($, 'emcc-badges').then(text => JSON.parse(text) as unknown[])
    expect((await badges()).at(-1)).toEqual({ id: 'witness', text: 'witness 0/1 proven, /live', tone: 'neutral' })
    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
    await ui.unmount()
    it.isWide = true
    await command($, 'live')
    expect((await badges()).at(-1)).toEqual({ id: 'witness' })
  })
})

describe('a pane placed later, once the terminal widens', () => {
  test('without emcc-core, the line above the prompt gives way to it', WITH_PROBE, async ($, on) => {
    const it = session(on)
    engineBand(on)
    it.isWide = false
    await call($, it, { tool: 'TaskCreate', subject: 'Fix withTax', description: 'x' })
    const narrow = await band($)
    expect((await narrow.find({ key: 'live' }))?.text).toBe('Live')
    await narrow.unmount()
    it.isWide = true
    const wide = await band($)
    expect(await wide.find({ type: 'Text', text: /engine band/ })).toBeDefined()
    await wide.unmount()
  })

  test('with emcc-core, the badge clears on the next call that can change a mark', WITH_EMCC, async ($, on) => {
    const it = session(on)
    it.isWide = false
    await call($, it, { tool: 'TaskCreate', subject: 'Fix withTax', description: 'x' })
    const badges = () => command($, 'emcc-badges').then(text => JSON.parse(text) as unknown[])
    expect((await badges()).at(-1)).toEqual({ id: 'witness', text: 'witness 0/1 proven, /live', tone: 'neutral' })
    it.isWide = true
    await call($, it, { tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
    expect((await badges()).at(-1)).toEqual({ id: 'witness' })
  })

  test('its dot beats for the next action', WITH_PROBE, async ($, on) => {
    const it = session(on)
    it.isWide = false
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    it.isWide = true
    const running = $.tool.call({ tool: 'Read', file_path: '/repo/a.js', holdMs: 3000 } as never)
    await it.clock.settle()
    const before = await state($, 'beat')
    await it.clock.advance(1000)
    expect(await state($, 'beat')).toBe(!before)
    await it.clock.advance(2000)
    await running
  })
})

describe('emcc-core that draws no band', () => {
  test('with its profile off, witness draws its own line above the prompt', WITH_EMCC, async ($, on) => {
    const it = session(on)
    engineBand(on)
    await command($, 'emcc-profile', 'off')
    it.isWide = false
    await call($, it, { tool: 'TaskCreate', subject: 'Fix withTax', description: 'x' })
    const ui = await band($)
    expect((await ui.find({ type: 'Text', text: /proven/ }))?.text).toBe('0/1 proven ')
    await ui.unmount()
  })

  test('halted, emcc-core draws its band, so witness leaves the line to it', WITH_EMCC, async ($, on) => {
    const it = session(on)
    engineBand(on)
    await command($, 'emcc-halt')
    it.isWide = false
    await call($, it, { tool: 'TaskCreate', subject: 'Fix withTax', description: 'x' })
    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('closing the pane', () => {
  test('without emcc-core, the line above the prompt comes back', WITH_PROBE, async ($, on) => {
    const it = session(on)
    engineBand(on)
    await call($, it, { tool: 'TaskCreate', subject: 'Fix withTax', description: 'x' })
    expect(await state($, 'isPlaced')).toBe(true)
    await closeByHand($)
    expect(await state($, 'isPlaced')).toBe(false)
    const ui = await band($)
    expect((await ui.find({ key: 'live' }))?.text).toBe('Live')
    await ui.unmount()
    // Closed by hand, it stays closed: the next call does not open it again.
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    expect(it.opened.length).toBe(1)
  })

  test('with emcc-core, the badge comes back', WITH_EMCC, async ($, on) => {
    const it = session(on)
    await call($, it, { tool: 'TaskCreate', subject: 'Fix withTax', description: 'x' })
    const badges = () => command($, 'emcc-badges').then(text => JSON.parse(text) as unknown[])
    expect(await badges()).toEqual([{ id: 'witness' }])
    await closeByHand($)
    expect((await badges()).at(-1)).toEqual({ id: 'witness', text: 'witness 0/1 proven, /live', tone: 'neutral' })
  })

  test('a close that is refused leaves the pane placed', WITH_PROBE, async ($, on) => {
    const it = session(on)
    engineBand(on)
    await call($, it, { tool: 'TaskCreate', subject: 'Fix withTax', description: 'x' })
    it.refusingClose = true
    await closeByHand($)
    expect(it.closed).toEqual(['witness'])
    expect(await state($, 'isPlaced')).toBe(true)
    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
    await ui.unmount()
  })

  test('another pane closing changes nothing', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    await command($, 'witness-close', 'other')
    expect(await state($, 'isPlaced')).toBe(true)
  })
})

describe('the pulse', () => {
  const dot = async (ui: { find: (query: { type: string; text: RegExp }) => Promise<{ props: { color?: unknown } } | undefined> }) =>
    (await ui.find({ type: 'Text', text: /^●$/ }))?.props.color

  test('the dot by Now beats once a second while an action runs', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    const running = $.tool.call({ tool: 'Read', file_path: '/repo/a.js', holdMs: 3000 } as never)
    await it.clock.settle()
    const ui = await pane($)
    const seen = [await dot(ui)]
    for (let second = 0; second < 2; second += 1) {
      await it.clock.advance(1000)
      seen.push(await dot(ui))
    }
    expect(seen).toEqual([STONE, CLAY, STONE])
    await it.clock.advance(1000)
    await running
    expect(await dot(ui)).toBeUndefined()
    await ui.unmount()
  })

  test('closing the pane stops the beat', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    const running = $.tool.call({ tool: 'Read', file_path: '/repo/a.js', holdMs: 5000 } as never)
    await it.clock.settle()
    await it.clock.advance(1000)
    await closeByHand($)
    const atClose = await state($, 'beat')
    await it.clock.advance(1000)
    expect(await state($, 'beat')).toBe(atClose)
    await it.clock.advance(1000)
    expect(await state($, 'beat')).toBe(atClose)
    await it.clock.advance(2000)
    await running
  })

  test('opened again with /live while an action runs, the dot beats again', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    const running = $.tool.call({ tool: 'Read', file_path: '/repo/a.js', holdMs: 5000 } as never)
    await it.clock.settle()
    await closeByHand($)
    await it.clock.advance(1000)
    await command($, 'live')
    const atOpen = await state($, 'beat')
    await it.clock.advance(1000)
    expect(await state($, 'beat')).toBe(!atOpen)
    await it.clock.advance(3000)
    await running
    // The beat ends with the action, as before.
    const atEnd = await state($, 'beat')
    await it.clock.advance(2000)
    expect(await state($, 'beat')).toBe(atEnd)
  })

  test('closed by hand, the next action does not pulse', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    await closeByHand($)
    const running = $.tool.call({ tool: 'Read', file_path: '/repo/a.js', holdMs: 3000 } as never)
    await it.clock.settle()
    const atStart = await state($, 'beat')
    await it.clock.advance(1000)
    expect(await state($, 'beat')).toBe(atStart)
    await it.clock.advance(1000)
    expect(await state($, 'beat')).toBe(atStart)
    await it.clock.advance(1000)
    await running
  })

  test('on a terminal too narrow for the pane, nothing pulses', WITH_PROBE, async ($, on) => {
    const it = session(on)
    it.isWide = false
    await prompt($, 'Fix it.')
    const running = $.tool.call({ tool: 'Read', file_path: '/repo/a.js', holdMs: 3000 } as never)
    await it.clock.settle()
    const atStart = await state($, 'beat')
    await it.clock.advance(1000)
    expect(await state($, 'beat')).toBe(atStart)
    await it.clock.advance(1000)
    expect(await state($, 'beat')).toBe(atStart)
    await it.clock.advance(1000)
    await running
  })

  test('opened again with nothing running, it stays still', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    await call($, it, { tool: 'Read', file_path: '/repo/a.js' })
    await closeByHand($)
    await command($, 'live')
    const atOpen = await state($, 'beat')
    await it.clock.advance(1000)
    expect(await state($, 'beat')).toBe(atOpen)
    await it.clock.advance(1000)
    expect(await state($, 'beat')).toBe(atOpen)
  })

  test('opened again while paused, it stays still', WITH_PROBE, async ($, on) => {
    const it = session(on)
    await prompt($, 'Fix it.')
    const running = $.tool.call({ tool: 'Read', file_path: '/repo/a.js', holdMs: 5000 } as never)
    await it.clock.settle()
    await closeByHand($)
    await command($, 'live', 'pause')
    await command($, 'live')
    const atOpen = await state($, 'beat')
    await it.clock.advance(1000)
    expect(await state($, 'beat')).toBe(atOpen)
    await it.clock.advance(4000)
    await running
  })
})
