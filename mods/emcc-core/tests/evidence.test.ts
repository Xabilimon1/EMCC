import { describe, expect, test } from 'claude-code/testing'

import { exitCodeOf, kindsOf } from '../hooks/evidence'

describe('kindsOf', () => {
  test('names the runners of each kind', async () => {
    expect(kindsOf('npm test')).toEqual(['test'])
    expect(kindsOf('pnpm run test -- --watch=false')).toEqual(['test'])
    expect(kindsOf('python3 -m pytest -q tests/')).toEqual(['test'])
    expect(kindsOf('cargo nextest run')).toEqual(['test'])
    expect(kindsOf('npx tsc --noEmit')).toEqual(['typecheck'])
    expect(kindsOf('ruff check .')).toEqual(['lint'])
    expect(kindsOf('npm run build')).toEqual(['build'])
  })

  test('a chain is every kind it runs', async () => {
    expect(kindsOf('npm run build && npm test')).toEqual(['test', 'build'])
  })

  test('other commands are no evidence', async () => {
    expect(kindsOf('git status')).toEqual([])
    expect(kindsOf('cat latest.txt')).toEqual([])
    expect(kindsOf('ls makefiles/')).toEqual([])
  })
})

describe('exitCodeOf', () => {
  test('reads the code the model saw', async () => {
    expect(exitCodeOf(false, 'ok')).toBe(0)
    expect(exitCodeOf(true, 'Exit code 2\nFAIL src/a.test.ts')).toBe(2)
    expect(exitCodeOf(true, undefined)).toBe(1)
  })
})
