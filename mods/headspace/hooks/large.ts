/**
 * The pure half of the large results: finding them in the live conversation
 * (`$.session.messages({ as: 'api' })`), their estimated tokens, short target
 * and age; the cache an apply rewrites; the instructions an apply sends.
 */

import type { ApiMessage } from 'claude-code'

import { formatTokens } from './bar'

/** A tool result in the live conversation. */
export type LargeResult = { id: string; tool: string; target: string; chars: number; tokens: number; turnsAgo: number; preview: string[] }

/**
 * headspace-cut's CUT_PREFIX, spelled again: a plugin cannot import another
 * plugin's module. The test holds the literal.
 */
export const CUT_PREFIX = 'headspace-cut:'

/** How the text of a stub headspace-cut wrote begins. */
const STUB_START = '[headspace removed'

const PREVIEW_LINES = 20
const COMMAND_CHARS = 40

type Block = { type: string; [field: string]: unknown }

/** The text of a tool_result's content: a string, or its text blocks joined by newlines. */
function resultText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }

  return (content as unknown[])
    .filter((b): b is { type: 'text'; text: string } => isBlock(b) && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n')
}

function isBlock(value: unknown): value is Block {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}

/** Characters a block puts before the model: text, a tool call's name and input, a result's text, thinking. */
function blockChars(block: Block): number {
  switch (block.type) {
    case 'text':
      return typeof block.text === 'string' ? block.text.length : 0
    case 'tool_use':
      return (typeof block.name === 'string' ? block.name.length : 0) + (JSON.stringify(block.input ?? {})?.length ?? 0)
    case 'tool_result':
      return resultText(block.content).length
    case 'thinking':
      return typeof block.thinking === 'string' ? block.thinking.length : 0
    default:
      return 0
  }
}

function totalChars(messages: readonly ApiMessage[]): number {
  let sum = 0
  for (const message of messages) {
    for (const block of message.content) {
      sum += blockChars(block)
    }
  }

  return sum
}

/** Tokens for `chars`: their share of `messageTokens`, or chars / 4 without it. */
function toTokens(chars: number, allChars: number, messageTokens: number | null): number {
  if (messageTokens === null) {
    return Math.round(chars / 4)
  }
  if (allChars <= 0) {
    return 0
  }

  return Math.round((chars / allChars) * messageTokens)
}

/** A user message holding text the person typed (a reminder alone is not one). */
function isPrompt(message: ApiMessage): boolean {
  if (message.role !== 'user') {
    return false
  }

  return message.content.some(b => b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '' && !b.text.trimStart().startsWith('<system-reminder>'))
}

function relative(path: string, cwd: string): string {
  const base = cwd.endsWith('/') ? cwd : cwd + '/'

  return path.startsWith(base) ? path.slice(base.length) : path
}

/** `https://host/path?q#h` -> `host/path`, without a trailing slash. */
function hostPath(url: string): string {
  const noScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const cut = noScheme.search(/[?#]/)
  const bare = cut === -1 ? noScheme : noScheme.slice(0, cut)

  return bare.replace(/\/+$/, '')
}

function targetOf(tool: string, input: unknown, cwd: string): string {
  const fields = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const text = (key: string): string | null => (typeof fields[key] === 'string' ? (fields[key] as string) : null)
  switch (tool) {
    case 'Read':
    case 'Edit':
    case 'Write': {
      const path = text('file_path')
      return path === null ? '' : relative(path, cwd)
    }
    case 'Bash': {
      const command = text('command')
      return command === null ? '' : (command.split('\n')[0] ?? '').slice(0, COMMAND_CHARS).trimEnd()
    }
    case 'WebFetch': {
      const url = text('url')
      return url === null ? '' : hostPath(url)
    }
    case 'Grep':
    case 'Glob':
      return text('pattern') ?? ''
    default:
      return ''
  }
}

/** Every tool_use in the messages, by id: its tool name and input. */
function callsById(messages: readonly ApiMessage[]): Map<string, { name: string; input: unknown }> {
  const calls = new Map<string, { name: string; input: unknown }>()
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_use' && typeof block.id === 'string') {
        calls.set(block.id, { name: typeof block.name === 'string' ? block.name : '', input: block.input })
      }
    }
  }

  return calls
}

/**
 * From `$.session.messages({ as: 'api' })`: every tool_result paired with its
 * tool_use, measured, and those of `threshold` tokens or more, biggest first.
 * Tokens are the result's share of `messageTokens` (the breakdown's Messages
 * figure) in proportion to characters, or chars / 4 when it is null.
 * `turnsAgo` counts the prompts the person typed after the result. Results
 * headspace-cut already stubbed are left out. `share` is the large results'
 * tokens over Messages (0..1), for bar.ts.
 */
export function largeResults(
  messages: readonly ApiMessage[],
  threshold: number,
  messageTokens: number | null,
  cwd: string,
): { results: LargeResult[]; share: number } {
  const allChars = totalChars(messages)
  const calls = callsById(messages)
  // Prompts typed from each message index to the end.
  const promptsFrom: number[] = new Array<number>(messages.length + 1).fill(0)
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    promptsFrom[i] = (promptsFrom[i + 1] ?? 0) + (message !== undefined && isPrompt(message) ? 1 : 0)
  }

  const results: LargeResult[] = []
  messages.forEach((message, index) => {
    for (const block of message.content) {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') {
        continue
      }
      const text = resultText(block.content)
      if (text.startsWith(STUB_START)) {
        continue
      }
      const tokens = toTokens(text.length, allChars, messageTokens)
      if (tokens < threshold) {
        continue
      }
      const use = calls.get(block.tool_use_id)
      const tool = use?.name ?? ''
      results.push({
        id: block.tool_use_id,
        tool,
        target: targetOf(tool, use?.input, cwd),
        chars: text.length,
        tokens,
        turnsAgo: promptsFrom[index + 1] ?? 0,
        preview: text.split('\n').slice(0, PREVIEW_LINES),
      })
    }
  })
  results.sort((a, b) => b.tokens - a.tokens || b.chars - a.chars)

  const whole = messageTokens ?? Math.round(allChars / 4)
  const largeTokens = results.reduce((sum, r) => sum + r.tokens, 0)
  const share = whole > 0 ? Math.min(1, Math.max(0, largeTokens / whole)) : 0

  return { results, share }
}

/** `Read src/data.json (9.8k tokens)`: what the stub names. */
export function label(result: LargeResult): string {
  const what = result.target === '' ? result.tool : `${result.tool} ${result.target}`

  return `${what} (${formatTokens(result.tokens)} tokens)`
}

/**
 * Tokens re-cached by cutting `ids`: every block from the first marked result
 * to the end, in the same estimate as largeResults. 0 when none is found.
 */
export function cacheCost(messages: readonly ApiMessage[], ids: readonly string[], messageTokens: number | null): number {
  const marked = new Set(ids)
  let isCounting = false
  let chars = 0
  for (const message of messages) {
    for (const block of message.content) {
      if (!isCounting && block.type === 'tool_result' && typeof block.tool_use_id === 'string' && marked.has(block.tool_use_id)) {
        isCounting = true
      }
      if (isCounting) {
        chars += blockChars(block)
      }
    }
  }

  return toTokens(chars, totalChars(messages), messageTokens)
}

/** The instructions an apply sends: CUT_PREFIX and the marks as JSON, as headspace-cut's parseCut reads them. */
export function cutInstructions(marks: { id: string; label: string }[]): string {
  return CUT_PREFIX + JSON.stringify({ marks: marks.map(({ id, label }) => ({ id, label })) })
}
