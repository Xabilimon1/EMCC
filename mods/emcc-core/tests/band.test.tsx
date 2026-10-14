import { expect, mock, test } from 'claude-code/testing'

import { probe } from './fixtures/probe'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100 },
} as const

test('the band shows evidence and badges, and Halt turns EMCC off, on both surfaces', { plugins: [probe] }, async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }) as never)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine band</Text>
  })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.command.run({ command: 'probe-badge', args: 'redgreen GREEN good' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'emcc-core', surface, ...BAND } as never)
    expect((await ui.find({ type: 'Text', text: /test pass/ }))?.text).toBe('test pass ')
    expect((await ui.find({ type: 'Text', text: /GREEN/ }))?.text).toBe('GREEN ')
    expect((await ui.find({ key: 'halt' }))?.text).toBe('Halt')
    await ui.press({ key: 'halt' })
    expect((await ui.find({ type: 'Text', text: /^halted/ }))?.text).toBe('halted ')
    expect((await ui.find({ key: 'halt' }))?.text).toBe('Resume')
    await ui.press({ key: 'halt' })
    await ui.unmount()
  }
})

test('with nothing to show the engine draws its own band', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine band</Text>
  })
  const ui = await $.ui.mount({ plugin: 'emcc-core', surface: 'terminal', ...BAND } as never)
  expect((await ui.find({ type: 'Text', text: /engine band/ }))?.text).toBe('engine band')
  await ui.unmount()
})

test('with something to show, what draws beneath (another mod: headspace, witness) stays, under the EMCC row', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }) as never)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>other band</Text>
  })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  const ui = await $.ui.mount({ plugin: 'emcc-core', surface: 'terminal', ...BAND } as never)
  expect((await ui.find({ type: 'Text', text: /test pass/ }))?.text).toBe('test pass ')
  expect((await ui.find({ type: 'Text', text: /other band/ }))?.text).toBe('other band')
  await ui.unmount()
})
