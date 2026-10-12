import type { CommandRunInput } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { probe } from './fixtures/probe'

const OK = { result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }
const FAILED = { isError: true, result: 'Exit code 2', text: 'Exit code 2\n1 failed' }
const WITH_PROBE = { plugins: [probe] }

async function run($: Engine, command: string, args = ''): Promise<string> {
  const input = { command, args } as CommandRunInput

  return (await $.command.run(input)).text ?? ''
}

describe('evidence', () => {
  test('a passing and a failing test run are recorded with their exit codes', WITH_PROBE, async ($, on) => {
    mock.clock(on, { now: 1000 })
    let answer: unknown = OK
    on('tool.call', () => answer as never)
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(JSON.parse(await run($, 'probe-latest', 'test'))).toMatchObject({ isOk: true, exitCode: 0, at: 1000 })
    answer = FAILED
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(JSON.parse(await run($, 'probe-latest', 'test'))).toMatchObject({ isOk: false, exitCode: 2 })
    expect(JSON.parse(await run($, 'probe-latest', 'lint'))).toBeNull()
  })

  test('a backgrounded run and an unrelated command record nothing', WITH_PROBE, async ($, on) => {
    mock.clock(on)
    on('tool.call', () =>
      ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' }, text: 'started' }) as never,
    )
    await $.tool.call({ tool: 'Bash', command: 'npm test', run_in_background: true })
    await $.tool.call({ tool: 'Bash', command: 'git status' })
    expect(JSON.parse(await run($, 'probe-since', '0'))).toEqual([])
  })

  test('an edit records its file', WITH_PROBE, async ($, on) => {
    mock.clock(on)
    on('tool.call', () => OK as never)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
    expect(JSON.parse(await run($, 'probe-latest', 'edit'))).toMatchObject({ file: '/repo/a.ts' })
  })
})

describe('profile and kill switch', () => {
  test('the configured profile stands until /emcc-halt, then off, then back', WITH_PROBE, async $ => {
    expect(await run($, 'probe-profile')).toBe('standard')
    expect(await run($, 'emcc-halt')).toContain('halted')
    expect(await run($, 'probe-halted')).toBe('true')
    expect(await run($, 'probe-profile')).toBe('off')
    await run($, 'emcc-halt')
    expect(await run($, 'probe-profile')).toBe('standard')
  })

  test('the profile option is read', { ...WITH_PROBE, options: { profile: 'strict' } }, async $ => {
    expect(await run($, 'probe-profile')).toBe('strict')
  })
})

describe('badges', () => {
  test('a badge is shown, replaced and removed, and /emcc lists it', WITH_PROBE, async $ => {
    await run($, 'probe-badge', 'redgreen RED bad')
    await run($, 'probe-badge', 'redgreen GREEN good')
    expect(await run($, 'emcc')).toContain('redgreen: GREEN')
    expect(await run($, 'emcc')).not.toContain('RED,')
    await run($, 'probe-badge', 'redgreen')
    expect(await run($, 'emcc')).toContain('Badges: none')
  })
})
