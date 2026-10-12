import { describe, expect, test } from 'claude-code/testing'

import { emcc } from './fixtures/emcc'
import type { Engine } from 'claude-code/testing'

import { bash, edit, goalposts, said, world } from './fixtures/world'

const SURFACES = ['terminal', 'desktop'] as const

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100 },
} as const

const PANE = {
  component: 'Pane',
  requestId: 'goalposts',
  props: { title: 'Goalpost Guard', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  viewport: { rows: 60, columns: 100 },
} as const

describe('the band', () => {
  test('stays the engine’s until something is held, then counts held and let through', async ($, on) => {
    const it = world(on)
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)

      return <Text>engine band</Text>
    })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'goalpost-guard', surface, ...BAND } as never)
      expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
      await ui.unmount()
    }
    it.answer = 'Block it'
    await edit($)
    it.answer = 'Allow once'
    await edit($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'goalpost-guard', surface, ...BAND } as never)
      expect((await ui.find({ type: 'Text', text: /held/ }))?.text).toBe('1 held ')
      expect((await ui.find({ type: 'Text', text: /let through/ }))?.text).toBe('1 let through ')
      expect((await ui.find({ key: 'ledger' }))?.text).toBe('Ledger')
      await ui.unmount()
    }
  })
})

describe('the pane', () => {
  test('lists each decision with what it removed, newest first, on both surfaces', async ($, on) => {
    const it = world(on)
    it.answer = 'keep the zero case'
    await edit($)
    it.answer = 'Allow once'
    await bash($, 'git commit -n -m wip')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'goalpost-guard', surface, ...PANE } as never)
      const titles = await ui.findAll({ type: 'Text', text: /^(removes|skips)/ })
      expect(titles.map(one => one.text)).toEqual(['skips the git hooks (git commit -n)', 'removes 1 assertion'])
      expect((await ui.find({ type: 'Text', text: /HELD/ }))?.text).toBe(' HELD  tests src/add.test.ts')
      expect((await ui.find({ type: 'Text', text: /ALLOWED/ }))?.text).toBe(' ALLOWED  bypass Bash')
      expect((await ui.find({ type: 'Text', text: /- expect/ }))?.text).toBe('  - expect(add(0, 0)).toBe(0)')
      expect((await ui.find({ type: 'Text', text: /keep the zero case/ }))?.text).toBe('  keep the zero case')
      await ui.unmount()
    }
  })

  test('the tabs and Pause answer to 1, 2, 3 and p', async ($, on) => {
    world(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'goalpost-guard', surface, ...PANE } as never)
      const keys: Record<string, string> = { 'tab-ledger': '1', 'tab-exceptions': '2', 'tab-rules': '3', pause: 'p' }
      for (const [key, hotkey] of Object.entries(keys)) {
        expect((await ui.find({ key }))?.props.hotkey).toBe(hotkey)
      }
      await ui.unmount()
    }
  })

  test('Allow in this file on a held entry makes an exception that the next change honors', async ($, on) => {
    const it = world(on)
    it.answer = 'Block it'
    await edit($)
    const ui = await $.ui.mount({ plugin: 'goalpost-guard', surface: 'terminal', ...PANE } as never)
    const [allow] = await ui.findAll({ type: 'Button', text: 'Allow in this file' })
    await ui.press({ key: allow?.key ?? '' })
    await ui.press({ key: 'tab-exceptions' })
    expect(await ui.find({ type: 'Text', text: /allowed from the ledger/ })).toBeDefined()
    await ui.unmount()
    await edit($)
    expect(it.asked.length).toBe(1)
    expect(it.ran.length).toBe(1)
  })

  test('Revoke takes an exception away', async ($, on) => {
    const it = world(on)
    it.answer = 'Allow in this file'
    await edit($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'goalpost-guard', surface, ...PANE } as never)
      await ui.press({ key: 'tab-exceptions' })
      const revoke = await ui.find({ type: 'Button', text: 'Revoke' })
      if (revoke !== undefined) {
        await ui.press({ key: revoke.key ?? '' })
      }
      expect(await ui.find({ type: 'Text', text: /No standing exceptions/ })).toBeDefined()
      await ui.press({ key: 'tab-ledger' })
      await ui.unmount()
    }
    await edit($)
    expect(it.asked.length).toBe(2)
  })

  test('Mute on the Rules tab stops a category for the session; Pause stops them all', async ($, on) => {
    const it = world(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'goalpost-guard', surface, ...PANE } as never)
      await ui.press({ key: 'tab-rules' })
      await ui.press({ key: 'toggle-tests' })
      expect((await ui.find({ key: 'toggle-tests' }))?.text).toBe('Unmute')
      await ui.press({ key: 'toggle-tests' })
      expect((await ui.find({ key: 'toggle-tests' }))?.text).toBe('Mute')
      await ui.press({ key: 'tab-ledger' })
      await ui.unmount()
    }
    const ui = await $.ui.mount({ plugin: 'goalpost-guard', surface: 'terminal', ...PANE } as never)
    await ui.press({ key: 'tab-rules' })
    await ui.press({ key: 'toggle-tests' })
    await edit($)
    expect(it.asked).toEqual([])
    await ui.press({ key: 'toggle-tests' })
    await ui.press({ key: 'pause' })
    expect((await ui.find({ key: 'pause' }))?.text).toBe('Resume')
    await edit($)
    expect(it.asked).toEqual([])
    await ui.press({ key: 'pause' })
    await edit($)
    expect(it.asked.length).toBe(1)
    await ui.unmount()
  })

  test('a category off in the config shows as such and has no button', { options: { coverage: false } }, async ($, on) => {
    world(on)
    const ui = await $.ui.mount({ plugin: 'goalpost-guard', surface: 'terminal', ...PANE } as never)
    await ui.press({ key: 'tab-rules' })
    expect(await ui.find({ key: 'toggle-coverage' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '/config' })).toBeDefined()
    await ui.unmount()
  })

  test('/goalposts opens the pane, and lists the ledger as text when it cannot', async ($, on) => {
    const it = world(on)
    let isPlaced = true
    on('ui.open', () => ({ value: isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'too narrow' } }) as never)
    it.answer = 'Block it'
    await edit($)
    expect(await goalposts($)).toBe('Goalpost Guard ledger opened.')
    isPlaced = false
    expect(await goalposts($)).toBe('HELD removes 1 assertion /repo/src/add.test.ts')
  })
})

async function profile($: Engine, value: string): Promise<void> {
  await $.command.run({ command: 'emcc-profile', args: value } as never)
}

async function lastBadge($: Engine): Promise<unknown> {
  const badges = JSON.parse((await $.command.run({ command: 'emcc-badges', args: '' } as never)).text ?? '[]') as unknown[]

  return badges.at(-1)
}

describe('with emcc-core', () => {
  const WITH_EMCC = { plugins: [emcc] }

  test('inherit follows the EMCC profile: standard asks, strict denies', WITH_EMCC, async ($, on) => {
    const it = world(on)
    await edit($)
    expect(it.asked.length).toBe(1)
    await profile($, 'strict')
    const out = await edit($)
    expect(said(out)).toContain('goalpost-guard refused this change')
    expect(it.asked.length).toBe(1)
  })

  test('EMCC off or halted turns goalpost-guard off, even with its own mode set', { ...WITH_EMCC, options: { mode: 'deny' } }, async ($, on) => {
    const it = world(on)
    await profile($, 'off')
    await edit($)
    expect(it.ran.length).toBe(1)
    await profile($, 'standard')
    expect(said(await edit($))).toContain('refused')
  })

  test('the count goes to the EMCC band as a badge instead of a line of its own', WITH_EMCC, async ($, on) => {
    const it = world(on)
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)

      return <Text>engine band</Text>
    })
    it.answer = 'Block it'
    await edit($)
    expect(await lastBadge($)).toEqual({ id: 'goalpost-guard', text: 'goalposts: 1 held', tone: 'good' })
    it.answer = 'Allow once'
    await edit($)
    expect(await lastBadge($)).toEqual({ id: 'goalpost-guard', text: 'goalposts: 1 held, 1 let through', tone: 'warn' })
    const own = await $.ui.mount({ plugin: 'goalpost-guard', surface: 'terminal', ...BAND } as never)
    expect(await own.find({ key: 'ledger' })).toBeUndefined()
    expect(await own.find({ type: 'Text', text: 'engine band' })).toBeDefined()
    await own.unmount()
  })
})
