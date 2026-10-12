import { describe, expect, test } from 'claude-code/testing'

import { SPEC, WEAKER, bash, edit, goalposts, said, world } from './fixtures/world'

describe('ask mode', () => {
  test('a change that lowers the bar asks first, and Allow once lets it run', async ($, on) => {
    const it = world(on)
    const out = await edit($)
    expect(it.asked).toEqual(['Goalpost Guard: this change src/add.test.ts removes 1 assertion. Allow it?'])
    expect(it.ran).toEqual(['Edit /repo/src/add.test.ts'])
    expect(out.deny).toBeUndefined()
  })

  test('Block it, or a dismissed dialog, refuses the change and the tool never runs', async ($, on) => {
    const it = world(on)
    it.answer = 'Block it'
    const blocked = await edit($)
    expect(said(blocked)).toContain('removes 1 assertion. The user blocked it.')
    it.answer = null
    expect(said(await edit($))).toContain('The user blocked it.')
    expect(it.ran).toEqual([])
  })

  test('typed text refuses the change and reaches Claude word for word', async ($, on) => {
    const it = world(on)
    it.answer = 'fix the rounding in add() instead'
    const out = await edit($)
    expect(said(out)).toContain('The user says: "fix the rounding in add() instead"')
    expect(it.ran).toEqual([])
  })

  test('Allow in this file stops asking for that rule in that file', async ($, on) => {
    const it = world(on)
    it.answer = 'Allow in this file'
    await edit($)
    await edit($)
    expect(it.asked.length).toBe(1)
    expect(it.ran.length).toBe(2)
    it.files.set('/repo/src/sub.test.ts', SPEC)
    await edit($, { ...WEAKER, file_path: '/repo/src/sub.test.ts' })
    expect(it.asked.length).toBe(2)
  })

  test('an exception stored by an earlier session is honored, in its project and file only', async ($, on) => {
    const exception = { project: '/repo', rule: 'tests.assertions', file: '/repo/src/sub.test.ts', note: 'flaky upstream', at: 1 }
    const elsewhere = { ...exception, project: '/elsewhere', file: undefined }
    const it = world(on, { '/repo/src/add.test.ts': SPEC, '/repo/src/sub.test.ts': SPEC }, { exceptions: [exception, elsewhere] })
    await edit($)
    expect(it.asked.length).toBe(1)
    await edit($, { ...WEAKER, file_path: '/repo/src/sub.test.ts' })
    expect(it.asked.length).toBe(1)
    expect(it.ran.length).toBe(2)
  })

  test('Allow in this project covers the rule in every file of the project', async ($, on) => {
    const it = world(on, { '/repo/src/add.test.ts': SPEC, '/repo/src/sub.test.ts': SPEC })
    it.answer = 'Allow in this project'
    await edit($)
    await edit($, { ...WEAKER, file_path: '/repo/src/sub.test.ts' })
    expect(it.asked.length).toBe(1)
  })

  test('with no screen it refuses by default, or lets it through and says so', async ($, on) => {
    const it = world(on)
    it.surfaces = []
    const out = await edit($)
    expect(said(out)).toContain('no one is here to allow it')
    expect(it.asked).toEqual([])
  })

  test('headless allow lets it run and tells Claude to report it', { options: { headless: 'allow' } }, async ($, on) => {
    const it = world(on)
    it.surfaces = []
    const out = await edit($)
    expect(it.ran.length).toBe(1)
    expect(out.context?.join(' ')).toContain('let this through unasked')
  })

  test('a change that keeps the bar runs untouched and asks nothing', async ($, on) => {
    const it = world(on)
    await edit($, { ...WEAKER, old_string: '  expect(add(0, 0)).toBe(0)\n', new_string: '  expect(add(0, 0)).toBe(0)\n  expect(add(2, 2)).toBe(4)\n' })
    await $.tool.call({ tool: 'Write', file_path: '/repo/src/new.ts', content: 'export const a = 1\n' } as never)
    await bash($, 'npm test')
    expect(it.asked).toEqual([])
    expect(it.ran.length).toBe(3)
  })
})

describe('modes and options', () => {
  test('deny refuses without asking', { options: { mode: 'deny' } }, async ($, on) => {
    const it = world(on)
    const out = await edit($)
    expect(said(out)).toContain('goalpost-guard refused this change: it src/add.test.ts removes 1 assertion')
    expect(it.asked).toEqual([])
    expect(it.ran).toEqual([])
  })

  test('warn runs the change and tells Claude to report it', { options: { mode: 'warn' } }, async ($, on) => {
    const it = world(on)
    const out = await edit($)
    expect(it.ran.length).toBe(1)
    expect(out.context?.join(' ')).toContain('goalpost-guard noted that this change src/add.test.ts removes 1 assertion')
  })

  test('off, and /goalposts pause, let everything through', { options: { mode: 'off' } }, async ($, on) => {
    const it = world(on)
    await edit($)
    expect(it.asked).toEqual([])
    expect(it.ran.length).toBe(1)
  })

  test('/goalposts pause and resume', async ($, on) => {
    const it = world(on)
    expect(await goalposts($, 'pause')).toContain('paused')
    await edit($)
    expect(it.asked).toEqual([])
    await goalposts($, 'resume')
    await edit($)
    expect(it.asked.length).toBe(1)
  })

  test('a category switched off in the config is not guarded', { options: { tests: false } }, async ($, on) => {
    const it = world(on)
    await edit($)
    expect(it.asked).toEqual([])
  })

  test('ignored paths are left alone', { options: { ignorePaths: ['src/**'] } }, async ($, on) => {
    const it = world(on)
    await edit($)
    expect(it.asked).toEqual([])
  })

  test('if the file cannot be read the change is held, not let through', async ($, on) => {
    const it = world(on)
    it.isReadBroken = true
    const out = await edit($)
    expect(said(out)).toContain('could not check this change (')
    expect(it.ran).toEqual([])
  })

  test('Write compares against the file on disk; a new file is compared against nothing', async ($, on) => {
    const it = world(on)
    await $.tool.call({ tool: 'Write', file_path: '/repo/src/add.test.ts', content: "it('adds', () => {})\n" } as never)
    expect(it.asked[0]).toContain('removes 2 assertions')
    await $.tool.call({ tool: 'Write', file_path: '/repo/src/b.ts', content: '// @ts-nocheck\n' } as never)
    expect(it.asked[1]).toContain('src/b.ts adds @ts-nocheck')
  })

  test('replace_all is applied the way Edit applies it', async ($, on) => {
    const it = world(on)
    await edit($, { file_path: '/repo/src/add.test.ts', old_string: 'toBe(', new_string: 'toBeDefined(', replace_all: true } as never)
    expect(it.asked[0]).toContain('loosens 2 assertions')
  })
})

describe('shell commands and commits', () => {
  test('--no-verify is held', async ($, on) => {
    const it = world(on)
    it.answer = 'Block it'
    const out = await bash($, 'git commit --no-verify -m "wip"')
    expect(said(out)).toContain('skips the git hooks (git commit --no-verify)')
    expect(it.ran).toEqual([])
  })

  test('the next commit carries a trailer for each change let through, once', async ($, on) => {
    const it = world(on)
    await edit($)
    await bash($, 'git add -A && git commit -m "fix add"')
    await bash($, 'git commit -m "second"')
    expect(it.ran[1]).toBe(
      "git add -A && git commit --trailer 'Goalpost-Change: src/add.test.ts: removes 1 assertion (allowed by the user)' -m \"fix add\"",
    )
    expect(it.ran[2]).toBe('git commit -m "second"')
  })

  test('a held change is not reported, and the trailer skips a quoted git commit', async ($, on) => {
    const it = world(on)
    it.answer = 'Block it'
    await edit($)
    await bash($, 'git commit -m "x"')
    expect(it.ran).toEqual(['git commit -m "x"'])
    it.answer = 'Allow once'
    await edit($)
    await bash($, 'echo "git commit" && git commit -m x')
    expect(it.ran[2]).toBe("echo \"git commit\" && git commit --trailer 'Goalpost-Change: src/add.test.ts: removes 1 assertion (allowed by the user)' -m x")
  })

  test('a failed commit keeps its trailers for the next one', async ($, on) => {
    const it = world(on)
    await edit($)
    it.isBashFailing = true
    await bash($, 'git commit -m a')
    await bash($, 'git commit -m b')
    expect(it.ran.filter(command => command.includes('--trailer')).length).toBe(2)
  })

  test('commitTrailer off leaves commits alone', { options: { commitTrailer: false } }, async ($, on) => {
    const it = world(on)
    await edit($)
    await bash($, 'git commit -m "fix add"')
    expect(it.ran[1]).toBe('git commit -m "fix add"')
  })
})

describe('/goalposts audit', () => {
  test('checks the changes since a ref, untracked files included', async ($, on) => {
    world(on, { '/repo/src/add.test.ts': "it('adds', () => {})\n", '/repo/src/new.ts': '// @ts-ignore\nx()\n' })
    on('process.run', (_$, e) => {
      const argv = (e as { argv: string[] }).argv.join(' ')
      const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
      if (argv === 'git diff --name-status -M main') {
        return out('M\tsrc/add.test.ts\n')
      }
      if (argv === 'git ls-files --others --exclude-standard') {
        return out('src/new.ts\n')
      }
      if (argv === 'git show main:src/add.test.ts') {
        return out(SPEC)
      }

      return out('', 128)
    })
    const text = await goalposts($, 'audit main')
    expect(text).toContain('2 changes lower the bar since main')
    expect(text).toContain('src/add.test.ts removes 2 assertions')
    expect(text).toContain('src/new.ts adds @ts-ignore')
  })

  test('says so when nothing lowers the bar, and when git fails', async ($, on) => {
    world(on)
    let code = 0
    on('process.run', () => ({ value: { exitCode: code, stdout: '', stderr: code === 0 ? '' : 'fatal: bad revision' } }) as never)
    expect(await goalposts($, 'audit')).toBe('Nothing in the changes since HEAD lowers the bar (0 files checked).')
    code = 128
    expect(await goalposts($, 'audit nope')).toBe('git diff nope failed: fatal: bad revision')
  })
})
