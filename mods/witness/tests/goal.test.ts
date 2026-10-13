import { describe, expect, test } from 'claude-code/testing'

import { goalFromPrompt, parseGoal, sameCommand } from '../hooks/goal'

describe('goalFromPrompt', () => {
  test('is the first sentence', async () => {
    expect(goalFromPrompt('Fix the rounding in withTax. Then run the tests.')).toBe('Fix the rounding in withTax.')
    expect(goalFromPrompt('make npm test pass\nonly edit test/')).toBe('make npm test pass')
    expect(goalFromPrompt('  why is CI red?  ')).toBe('why is CI red?')
  })

  test('a long one is cut to 100 characters', async () => {
    const cut = goalFromPrompt('a'.repeat(150))
    expect(cut.length).toBe(100)
    expect(cut.endsWith('…')).toBe(true)
  })

  test('a long one is cut by characters, never in the middle of an emoji', async () => {
    const cut = goalFromPrompt('😀'.repeat(150))
    expect(Array.from(cut).length).toBe(100)
    expect(cut).toBe(`${'😀'.repeat(99)}…`)
  })

  test('a version number is not the end of a sentence', async () => {
    expect(goalFromPrompt('Upgrade to 2.1.287 and fix the build.')).toBe('Upgrade to 2.1.287 and fix the build.')
  })
})

describe('parseGoal', () => {
  test('criteria follow "done when", split by semicolons, commands in backticks', async () => {
    expect(parseGoal('fix withTax rounding; done when `npm test` passes; the README shows the new rate')).toEqual({
      goal: 'fix withTax rounding',
      criteria: [
        { text: '`npm test` passes', command: 'npm test', isTicked: false },
        { text: 'the README shows the new rate', command: null, isTicked: false },
      ],
    })
  })

  test('"hecho cuando" works the same, and a command keeps one space between words', async () => {
    expect(parseGoal('arreglar el carrito, hecho cuando `npm   test` pasa').criteria).toEqual([
      { text: '`npm   test` pasa', command: 'npm test', isTicked: false },
    ])
    expect(parseGoal('arreglar el carrito, hecho cuando `npm   test` pasa').goal).toBe('arreglar el carrito')
  })

  test('without "done when" the whole text is the goal', async () => {
    expect(parseGoal('  ship the cart fix ')).toEqual({ goal: 'ship the cart fix', criteria: [] })
  })
})

describe('sameCommand', () => {
  test('ignores extra whitespace only', async () => {
    expect(sameCommand('npm  test ', 'npm test')).toBe(true)
    expect(sameCommand('npm test -- -u', 'npm test')).toBe(false)
  })
})
