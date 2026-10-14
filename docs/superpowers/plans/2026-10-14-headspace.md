# headspace Implementation Plan

> **For agentic workers:** this plan runs as a Workflow: one agent per task (or per group of tasks with disjoint files), then a combined review. Steps use checkbox (`- [ ]`) syntax. Load the `plugin-authoring` skill before writing any hooks module. The engine's API is declared in `.claude/types/claude-code.d.ts` at the repo root (about 18,000 lines: grep it for a name, then read the declaration).

**Goal:** Build `headspace` (an interactive context bar above the prompt, and a pane to turn rules off, edit them, add session rules, save them, and remove large tool results) and `headspace-cut` (the companion that answers headspace's compactions), as specified in `docs/superpowers/specs/2026-10-13-headspace-design.md`.

**Architecture:** Two plugins in `mods/`. Pure functions (`bar.ts`, `rules.ts`, `memory.ts`, `large.ts`, `cut.ts`) hold every calculation and are tested on their own; `register.tsx` wires hooks, state and drawing. headspace never answers a compaction: it calls `$.session.compact({ instructions: 'headspace-cut:' + JSON })` from a button press, and `headspace-cut` answers it.

**Tech Stack:** Claude Code 2.1.287 function hooks (TypeScript/TSX, `h` JSX factory), `claude plugin test`, `claude plugin validate --strict`, `npx -y -p typescript tsc -p .` from the repo root.

---

## Facts settled by the spike (2026-10-13/14, real sessions, Haiku 4.5)

Implementers rely on these; do not re-derive them.

1. **A plugin never sees a compaction it started.** `$.session.compact()` from a button's `onPress` or a `$.clock.after` timer works, but every hook of the calling plugin is skipped and core summarizes. From a `command.run` hook the call throws: `session.compact: called from a command.run hook, it would compact under the turn this hook is holding; call it from a later event (turn.complete) (host check)`.
2. **Another plugin can answer it.** A `session.compact` hook in a second plugin, on `e.trigger === 'plugin'`, returning `{ messages }` without `next`, replaced the result with a stub; no summary was made; the model, asked without tools, quoted the stub. Unchanged messages keep their `handle`; a changed one is rebuilt without `handle` as `{ role, text, toolUses, toolResults }` (`toolResults: [{ tool_use_id, text, isError }]`).
3. **`/compact <text>` typed by the person** reaches every plugin's `session.compact` with `trigger: 'manual'` and `instructions: '<text>'`.
4. **The live conversation is `$.session.messages({ as: 'api' })`.** It is exactly what the model reads: after a surgical compaction it holds the stub; after a normal compaction only the summary and what followed. Plain `$.session.messages()` keeps every row ever appended, compacted ones included: never use it for the large list. In the API form, tool calls are `tool_use` blocks (`id`, `name`, `input`) in assistant messages and results are `tool_result` blocks (`tool_use_id`, `content`: a string or text blocks) in user messages. The engine appends `<system-reminder>` text inside some tool results; count it, it is part of what the model reads.
5. **Auto-memory** is the system prompt section `memory` (`prompt.section`, `e.name === 'memory'`), not part of `claudeMd`. The section carries the engine's instructions plus the index entries (lines like `- [Title](file.md) — hook`).
6. **`prompt.context`** gets `blocks` (`claudeMd`, `userEmail`, `currentDate`, …) and `instructionFiles` (`{ path, kind, content, parent? }`; `content` has comments and frontmatter stripped). A block a plugin appends reaches the model and is there again after `/compact` (the hook runs again on re-read).
7. **Breakdown** (`$.session.usage({ breakdown: 'summary' })`) categories seen: `System prompt`, `System tools`, `MCP server instructions`, `MCP tools (deferred)` (kind `deferred`), `System tools (deferred)` (kind `deferred`), `Memory files`, `Skills`, `Messages`, `Free space` (kind `free`); `Autocompact buffer` (kind `buffer`) appears when the window has one; `Custom agents`, `MCP tools` when present. Its Messages figure does not match characters/4 (a 36k-character Read sat inside ~4k Messages tokens).
8. **Band** (`AbovePrompt`): segments drawn as coloured `Text` inside keyed `Box`es and a `Button` render; `ctrl+x tab` focuses the band's buttons and Enter presses. Hover is not checkable in VHS.

## File structure

```
mods/headspace-cut/
  .claude-plugin/plugin.json        name, version 0.1.0, description, author, repository, license, keywords, types
  hooks/hooks.json                  { "modules": ["./register.ts"] }
  hooks/cut.ts                      pure: CUT_PREFIX, parseCut, cutMessages
  hooks/register.ts                 session.start writes `ready`; session.compact answers headspace-cut: compactions
  types/index.d.ts                  PluginState['headspace-cut'] = { ready: boolean }
  tests/cut.test.ts                 pure
  tests/register.test.ts            simulated session
  README.md
mods/headspace/
  .claude-plugin/plugin.json        dependencies ["headspace-cut"], userConfig threshold, types
  hooks/hooks.json                  { "modules": ["./register.tsx"] }
  hooks/bar.ts                      pure: kinds, widths, fallbacks
  hooks/rules.ts                    pure: parse, render, diff, rule ids
  hooks/memory.ts                   pure: index entries of the memory section, render without the off ones
  hooks/large.ts                    pure: large results from API messages, sizes, labels, cache cost, cut instructions
  hooks/register.tsx                hooks, state, band, pane, actions
  types/index.d.ts                  PluginState['headspace'] contract
  tests/{bar,rules,memory,large}.test.ts   pure
  tests/register.test.ts            hooks and actions, simulated session
  tests/ui.test.tsx                 band and pane drawing, both surfaces
  tests/fixtures/{session,probe}.ts as witness's fixtures do (copy their idioms: mock clock, probe plugin for $.state reads)
  README.md
.claude-plugin/marketplace.json     two new entries
README.md                           one row for headspace in the mod table, the install line
```

Follow witness for idioms: `mods/witness/hooks/register.tsx` (atoms, wrapped hooks, `lostAt`, render on both surfaces), `mods/witness/tests/fixtures/session.ts` and `probe.ts` (a test cannot read `$.state` itself; a probe plugin does), `mods/witness/tests/ui.test.tsx` (mounting `Pane` and `AbovePrompt`).

Shared rules for every task:
- **TDD, and every test seen red.** After a test passes, break the line of code it guards, run it, see it fail, restore. Note in the report which break each test caught. A test that never failed watches nothing.
- **Verify from the repo root:** `claude plugin test mods/<mod>`, `claude plugin validate --strict .`, `npx -y -p typescript tsc -p .` (tsc only works from the root).
- **Do not commit.** The workflow commits after each phase, so parallel agents never race on git's index.
- **Never install anything into the user's Claude config.** No `claude plugin install`. Real sessions only with `--plugin-dir`.
- Text in the mods is English. No ` · ` separators in UI text. No emoji.

## Shared types

`mods/headspace/types/index.d.ts` (Task 2 writes it; every later task uses these names):

```ts
export type HeadspaceKind = 'system' | 'rules' | 'conversation' | 'large' | 'free' | 'reserve'

/** One segment of the bar: its kind and tokens. */
export type HeadspaceSegment = { kind: HeadspaceKind; tokens: number }

/** The bar's last reading. `window` is the breakdown's rawMaxTokens; `percent` its percentage. */
export type HeadspaceSnapshot = { segments: HeadspaceSegment[]; window: number; percent: number; at: number }

/** A change to one rule, keyed by its RuleId (see rules.ts). */
export type HeadspaceRuleChange =
  | { type: 'off' }
  | { type: 'edit'; lineIndex: number; text: string }
  | { type: 'addLine'; afterLineIndex: number; text: string }

/** A file's changes; `source` is the path, or 'memory' for auto-memory entries. */
export type HeadspaceFileChanges = { source: string; changes: Record<string, HeadspaceRuleChange[]> }

/** A large result the person marked: what headspace-cut needs to stub it. */
export type HeadspaceMark = { id: string; label: string }

declare module 'claude-code' {
  interface PluginState {
    headspace: {
      snapshot: HeadspaceSnapshot | null
      /** Changes waiting for Apply. */
      pending: HeadspaceFileChanges[]
      /** Changes in force: what prompt.context and prompt.section apply. */
      applied: HeadspaceFileChanges[]
      sessionRules: string[]
      /** Session rules waiting for Apply (added or removed since the last Apply). */
      pendingSessionRules: string[] | null
      marks: HeadspaceMark[]
      /** Changes dropped because their file changed on disk. */
      staleCount: number
      /** The kind the pane shows. */
      selected: HeadspaceKind
      /** The rule or large result selected in the pane, by id. */
      cursor: string | null
      /** Set while a cut compaction is in flight. */
      isCutting: boolean
      /** The last event a hook failed at, shown in the pane. */
      lostAt: string | null
    }
  }
}
```

`mods/headspace-cut/types/index.d.ts`:

```ts
declare module 'claude-code' {
  interface PluginState {
    'headspace-cut': { ready: boolean }
  }
}
export {}
```

Backups go to `$.store` under key `backup:<absolute path>`: `{ saves: { at: number; text: string }[] }`, newest last, at most 10.

---

### Task 1: headspace-cut (the companion)

**Files:** everything under `mods/headspace-cut/`, plus its entry in `.claude-plugin/marketplace.json`.

**`hooks/cut.ts`:**

```ts
export const CUT_PREFIX = 'headspace-cut:'

/** What headspace sends: the results to stub, each with the label its stub names. */
export type CutRequest = { marks: { id: string; label: string }[] }

/** Reads `instructions`; null when they are not a headspace-cut request or do not parse. */
export function parseCut(instructions: string | undefined): CutRequest | null

/** The stub a removed result becomes. */
export function stubText(label: string): string
// => `[headspace removed the result of ${label}; run it again if you need it]`

/**
 * Every message as it was (same object, handle kept) except user messages
 * holding a marked result: rebuilt without `handle` as { role, text, toolUses,
 * toolResults }, the marked results' text replaced by the stub, the others kept.
 * `missing` lists marked ids found in no message.
 */
export function cutMessages<M extends { role: string; text: string; toolUses: unknown[]; toolResults?: { tool_use_id: string; text: string; isError: boolean }[]; handle?: string }>(
  messages: readonly M[], request: CutRequest,
): { messages: (M | Omit<M, 'handle'>)[]; missing: string[] }
```

Tests (`tests/cut.test.ts`), each seen red:
- `parseCut('headspace-cut:{"marks":[{"id":"t1","label":"Read a.json (9.8k tokens)"}]}')` returns the request; `parseCut(undefined)`, `parseCut('the plan')`, `parseCut('headspace-cut:not json')`, `parseCut('headspace-cut:{"marks":[{"id":1}]}')` return null; leading/trailing whitespace is tolerated (`/compact` may pass it).
- `stubText('Read a.json (9.8k tokens)')` equals `[headspace removed the result of Read a.json (9.8k tokens); run it again if you need it]`.
- `cutMessages`: an untouched message is the same object (`toBe`) with its handle; a message with one marked and one unmarked result keeps the unmarked text and loses `handle`; `missing` lists an id no message holds; an empty request returns every message untouched.

**`hooks/register.ts`:**
- `session.start`: write `ready: true` to `$.state` (`{ plugin: 'headspace-cut', key: 'ready' }`), then `next(e)`.
- `session.compact`: `const request = parseCut(e.instructions)`. If null, or `e.trigger` is neither `'plugin'` nor `'manual'`: `return next(e)` untouched. Otherwise, without calling `next`: `cutMessages`; if `missing.length > 0` or anything throws, answer `{ skip: 'headspace-cut: <reason>' }` (never fall through to `next`, which would summarize). Else answer `{ messages }`.

Tests (`tests/register.test.ts`), simulated with a core stand-in beneath that answers `{ messages: [summary] }` and records it ran: a `plugin` compaction with valid instructions returns the stubbed list and core never runs; same for `manual`; a compaction with other instructions reaches core untouched; one with a missing id answers `{ skip }` and core never runs; `ready` is true after `session.start` (read through a probe plugin, as witness's tests do).

`plugin.json`: `{ "name": "headspace-cut", "version": "0.1.0", "description": "headspace's companion: answers the compactions headspace starts, replacing the marked tool results with one line each and summarizing nothing.", "author": { "name": "Xabilimon1", "url": "https://github.com/Xabilimon1" }, "repository": "https://github.com/Xabilimon1/emcc-claude-code-mods", "license": "MIT", "keywords": ["emcc", "context", "compaction"], "types": "./types/index.d.ts" }`.

`README.md`: short: what it does, that it is installed by headspace, and that `/compact headspace-cut:{"marks":[…]}` is what it answers.

### Task 2: headspace scaffold

**Files:** `mods/headspace/.claude-plugin/plugin.json`, `hooks/hooks.json`, `types/index.d.ts` (exactly the Shared types above), `hooks/register.tsx` (an empty `register` that only registers `/headspace` answering `{ text: 'headspace' }`, so the mod loads), marketplace entry.

`plugin.json`: name `headspace`, version `0.1.0`, description `"What Claude carries, in colour: a bar above the prompt with system, rules, conversation and large tool results, and a pane to turn rules off for the session, edit and save them, and take out large results."`, author, repository, license, keywords `["emcc", "context", "visual", "claude-md", "rules"]`, `"types": "./types/index.d.ts"`, `"dependencies": ["headspace-cut"]`, `"userConfig"`: one field `threshold`, a number, default 2000, described as "Tool results at or above this many tokens show as large" (grep `userConfig` in the types file for the exact manifest shape).

Verify: `claude plugin validate --strict .` passes; `tsc -p .` passes.

### Task 3: `bar.ts`

```ts
import type { HeadspaceKind, HeadspaceSegment } from '../types'

export const COLOURS: Record<HeadspaceKind, string> = {
  system: '#b0aea5', rules: '#d97757', conversation: '#6a9bcc', large: '#788c5d', free: '#e8e6dc', reserve: '#b0aea5',
}
export const ORDER: HeadspaceKind[] = ['system', 'rules', 'conversation', 'large', 'free', 'reserve']

/** A breakdown category as the engine gives it. */
export type Category = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }

/**
 * The six kinds from the breakdown. Deferred categories are left out. `Memory files` -> rules
 * (plus `sessionRuleTokens`); `Messages` -> conversation minus large; `Free space` -> free;
 * kind `buffer` -> reserve; every other used category -> system. `largeShare` is the
 * fraction (0..1) of Messages that large results take (from large.ts); large never exceeds Messages.
 */
export function toSegments(categories: Category[], largeShare: number, sessionRuleTokens: number): HeadspaceSegment[]

/** One drawn cell run per segment. */
export type Cell = { kind: HeadspaceKind; width: number }

/**
 * Widths for `columns` cells, proportional to tokens over `window`; every segment with
 * tokens > 0 gets at least 1 cell; the sum is exactly `columns` when tokens fill the window,
 * never more. Largest-remainder rounding, ties to the earlier kind in ORDER.
 */
export function widths(segments: HeadspaceSegment[], window: number, columns: number): Cell[]

/** How much text fits beside the bar: 'full' (labels and counts), 'counts' (no labels), 'bare' (percentage only). */
export function fallback(bodyColumns: number): 'full' | 'counts' | 'bare'
// full from 100 columns, counts from 70, bare below.

/** `9.2k`, `148k`, `950`, `1.2M`. */
export function formatTokens(n: number): string
```

Tests: the seven categories of fact 7 map to the right kinds (deferred dropped, `MCP server instructions` to system); largeShare 0.5 moves half of Messages; largeShare above 1 is clamped; widths sum to columns on a full window and below it otherwise; a 1-token segment still gets 1 cell; ties go to the earlier kind; `fallback(100)`, `fallback(99)`, `fallback(70)`, `fallback(69)`; `formatTokens` for 0, 950, 9200, 148000, 1200000.

### Task 4: `rules.ts`

```ts
/** One rule: its heading (the nearest `#` line above, '' at the top), position under it, and lines. */
export type Rule = { id: string; heading: string; index: number; lines: string[]; start: number; end: number }

/** A parsed file: every line, and the rules found in it. Lines outside rules (headings, blanks, fences) are kept as they are. */
export type ParsedFile = { lines: string[]; rules: Rule[]; eol: '\n' | '\r\n'; finalNewline: boolean }

/**
 * Splits text into rules: under each heading, each top-level list item (`- `, `* `, `+ `, `1. `)
 * with its continuation lines (indented lines and nested items), or each paragraph (a run of
 * non-blank lines that is not a heading). A fenced code block (``` or ~~~) is never split: it belongs
 * whole to the rule it sits in, or is a rule of its own. Headings are not rules.
 * `id` = `${heading}#${index}#${hash(lines.join('\n'))}`, hash a short stable string hash (FNV-1a, hex).
 */
export function parseRules(text: string): ParsedFile

/** The text with changes applied: off removes the rule's lines; edit replaces line `lineIndex` of the rule; addLine inserts after `afterLineIndex`. Unknown ids are reported, not applied. */
export function renderRules(file: ParsedFile, changes: Record<string, HeadspaceRuleChange[]>): { text: string; unknown: string[] }

/** A line diff for the save confirmation: each line `{ type: 'same' | 'out' | 'in', text }`. LCS on lines. */
export function diffLines(before: string, after: string): { type: 'same' | 'out' | 'in'; text: string }[]
```

Tests (the byte-for-byte one first): `renderRules(parseRules(t), {}).text === t` for at least five shapes: headings with lists, nested lists, a paragraph rule, a fenced block containing `- ` lines and `#` lines, CRLF line ends, no final newline, an `@path` import line, an empty file. Then: off removes exactly the rule's lines; edit changes one line; addLine inserts one; two changes on different rules; an unknown id lands in `unknown`; ids are stable when an unrelated rule elsewhere changes text, and change when the rule's own text changes; `diffLines` on a removed rule shows its lines `out` and the rest `same`.

### Task 5: `memory.ts`

```ts
/** An auto-memory index entry: a line `- [Title](file.md) ...` in the memory section. */
export type MemoryEntry = { id: string; title: string; line: string }

/** The entries of the section text, in order; id = `memory#${hash(line)}`. */
export function memoryEntries(sectionText: string): MemoryEntry[]

/** The section text with the entries whose id is in `off` removed; everything else byte for byte. */
export function renderMemory(sectionText: string, off: ReadonlySet<string>): string
```

Tests: entries found among instruction prose; prose lines that start with `- ` but are not `- [x](y)` links are not entries; renderMemory with an empty set is identical; removing one entry removes only its line; ids stable under reordering of other entries.

### Task 6: `large.ts`

```ts
/** A tool result in the live conversation. */
export type LargeResult = { id: string; tool: string; target: string; chars: number; tokens: number; turnsAgo: number; preview: string[] }

/**
 * From `$.session.messages({ as: 'api' })` (fact 4): pairs every tool_result with its tool_use
 * (by id), measures its content's characters (string or text blocks joined), and returns those
 * whose tokens >= threshold, biggest first. Tokens: the result's share of `messageTokens`
 * (the breakdown's Messages figure) in proportion to characters over all message characters;
 * when `messageTokens` is null, chars / 4. `turnsAgo` counts user messages that hold text typed by the person
 * after the result (a user message made only of tool_results is not a turn). `preview` is the
 * first 20 lines. `target`: Read/Edit/Write `file_path` (relative to `cwd` when inside it),
 * Bash `command` first line cut at 40 chars, WebFetch `url` host+path, Grep/Glob `pattern`, else ''.
 * Results already stubbed (text starts with `[headspace removed`) are left out.
 */
export function largeResults(messages: readonly ApiMessage[], threshold: number, messageTokens: number | null, cwd: string): { results: LargeResult[]; share: number }
// share = tokens of all results >= threshold over messageTokens (0..1), for bar.ts.

/** `Read src/data.json (9.8k tokens)`: what the stub names. */
export function label(result: LargeResult): string

/** Tokens re-cached by cutting `ids`: the sum of message tokens from the first marked result to the end (same proportional estimate). */
export function cacheCost(messages: readonly ApiMessage[], ids: readonly string[], messageTokens: number | null): number

/** The instructions an apply sends: CUT_PREFIX + JSON.stringify({ marks }). Must round-trip through headspace-cut's parseCut. */
export function cutInstructions(marks: { id: string; label: string }[]): string
```

`ApiMessage` comes from the engine types (grep `export type ApiMessage`). Do not import from `mods/headspace-cut` (separate plugin); duplicate the `'headspace-cut:'` constant and add a test that the two spellings match by reading both files' exported value through a test import of `../../headspace-cut/hooks/cut` only if the test runner allows cross-mod imports; otherwise a test asserting the literal.

Tests: a Read of 40k chars with threshold 2000 and messageTokens null is large with 10000 tokens; a 4k-char result is not; proportional mode (fact 7 numbers: 36,205 chars among ~40k chars of messages and messageTokens 4052) gives about 3.7k; string and block contents both measured; a stubbed result is excluded; turnsAgo counts only prompts typed after; targets per tool; `cacheCost` from the first marked result; `cutInstructions` output parses back (assert against the literal prefix).

### Task 7: register.tsx: hooks and state (no drawing yet)

**Files:** `mods/headspace/hooks/register.tsx`, `tests/register.test.ts`, `tests/fixtures/{session,probe}.ts`.

Atoms for every key of the contract (witness's pattern). Every hook body wrapped: on an exception write `lostAt` and return core's answer unchanged.

- `session.start`: register `/headspace` (`description: 'Show what Claude carries and take pieces out'`).
- `turn.complete` (only when `e.agentId === undefined`): `refresh($)`.
- `refresh($)`: `usage = await $.session.usage({ breakdown: 'summary' })`; no breakdown, leave `snapshot` null. Else `api = await $.session.messages({ as: 'api' })`, `largeResults(api, threshold, messagesCategoryTokens, cwd)`, `toSegments(categories, share, tokensOf(sessionRules))` (session rule tokens: chars/4), write `snapshot`. Drop marks whose id is no longer among the results.
- `prompt.context`: `r = await next(e)`. For each `applied` entry whose source is one of `e.instructionFiles` paths: re-parse that file's `content` with `parseRules`, drop changes whose rule id is not found (count them into `staleCount`), render, and rebuild the `claudeMd` block: replace the file's original `content` inside the block's text with the rendered text (the block frames each file; replace the exact substring once; if the substring is not found, leave the block unchanged and count the changes stale). Append `{ name: 'sessionRules', text: 'Session rules the person set for this session:\n' + rules.map(r => '- ' + r).join('\n') }` when there is at least one. Return `{ blocks }`. If `instructionFiles` is undefined (another hook rewrote `claudeMd`), apply nothing and leave a `lostAt: 'prompt.context (claudeMd rewritten above headspace)'` note.
- `prompt.section` on `{ name: 'memory' }`: `r = await next(e)`; if `r.text` and memory changes are applied, `{ text: renderMemory(r.text, offIds) }`.
- Actions (functions the pane's buttons call; exported for tests through commands, as witness's tests drive `/live`): 
  - `toggleRule(source, ruleId)`, `editLine(source, ruleId, lineIndex, text)`, `addLine(source, ruleId, afterLineIndex, text)`: write to `pending`.
  - `addSessionRule(text)`, `removeSessionRule(index)`: write `pendingSessionRules`.
  - `applyRules()`: move `pending` into `applied` (merging per source and rule), `pendingSessionRules` into `sessionRules`, then `$.ui.invalidate('prompt.context')` and `$.ui.invalidate('prompt.section')`.
  - `toggleMark(id)`.
  - `applyCut()`: refused (returns a reason) while a turn runs, while `isCutting`, with no marks, or when `headspace-cut` is not ready (read `{ plugin: 'headspace-cut', key: 'ready' }`; false or unreadable means not installed). Else set `isCutting`, `await $.session.compact({ instructions: cutInstructions(marks) })`, clear marks and `isCutting`, `refresh($)`. On `{ skip }` show the reason in the pane (`lostAt` stays null; a skip is not a crash).
  - `save(source)`, `undoSave(source)`: Task 9.
- Test-only commands are not shipped: drive actions in tests through `/headspace <verb> <args>` subcommands that the mod does ship as keyboard-free fallbacks: `/headspace` (open on rules), `/headspace large`, `/headspace apply`, `/headspace cut`. `/headspace cut` must not call `applyCut` inside its `command.run` hook (fact 1: the host throws); it schedules it with `$.clock.after(0, () => void applyCut($))` and answers `{ text: 'removing N results' }`. Everything else is driven by pressing the pane's buttons in ui tests (Task 8), as witness's ui tests press buttons.

Tests: refresh builds a snapshot from a stubbed breakdown and API messages; a subagent's turn end does not refresh; prompt.context with an applied off-change removes that rule from `claudeMd` and only that; a change whose rule changed on disk is dropped and counted stale; session rules add the block; nothing applied returns core's blocks identical; a throwing renderer returns core's blocks unchanged and sets `lostAt`; prompt.section removes an off memory entry; applyCut sends instructions that start with `headspace-cut:`; applyCut is refused without headspace-cut ready, while a turn runs, with no marks; a `{ skip }` answer leaves marks in place and shows the reason.

### Task 8: drawing: band and pane

**Files:** `register.tsx` (the `ui.render` hooks), `tests/ui.test.tsx`.

- **Band** (`AbovePrompt`): nothing (pass `next(e)`) when `snapshot` is null. Else one row: a keyed `Box` per non-empty segment (`key={'seg-' + kind}`), its cells as `Text color={COLOURS[kind]}` of `█` (`░` for reserve, `dimColor` for free), `hover={{ backgroundColor: ... }}` lighting it, and an absolutely placed card `Box` (`position="absolute" top={-3} display="none" hover={{ display: 'flex' }} borderStyle="round"`) holding `kind  tokens`, the piece count, and `click to view and remove` (rules, large) or `view only` (system, conversation, free, reserve). Each segment is pressable: wrap it so a press (pointer, or Enter under focus after ctrl+x tab) calls `openOn(kind)` (grep `onPress` in the types for which elements take it; use `Button plain` with the cells as its label if `Box` takes no `onPress`). After the bar: the percentage, then per `fallback(bodyColumns)` the labels and counts (`rules 9.2k  2 off`, `large 16k  3 marked`, `1 change no longer applies` when `staleCount > 0`). Text uses two spaces between items, never ` · `.
- **Pane** (`requestId: 'headspace'`, opened by `openOn(kind)` with `$.ui.open({ id: 'headspace', title: 'headspace', closeOnEscape: true, focus: true })`): a tab row of the six kinds (coloured, the selected one inverse), then the selected kind's body:
  - rules: groups per file (`path  kind  tokens`), each rule a row `●`/`○` + first line + tokens; selecting a row shows its whole text and buttons **on/off**, **edit** (an `Input` prefilled with the selected line), **add line**, and per file **save** / **undo save** (Task 9); a group `session rules` with its rules and an `Input` "add a session rule"; at the bottom **apply** with `rewrites ~<cost> of cache` where cost is the snapshot's total used tokens (rules sit in the first message). `Managed` files show rows without buttons and the word `managed`.
  - large: rows `[x]`/`[ ]` tool target size `N turns ago`, biggest first; **view** shows the preview; **apply** with `frees <sum>, rewrites ~<cacheCost>`; dimmed with a reason when refused (turn running, headspace-cut missing: `install headspace-cut to remove results`).
  - system, conversation, free, reserve: the categories behind the kind with their tokens, read-only.
  - `lostAt` set: a line `headspace lost track at <event>` on top.

Tests (terminal and desktop surfaces, as witness's ui tests): the band draws six colours for a full snapshot; a 1-token kind still draws one cell; each segment holds its card with the right action text; pressing the rules segment opens the pane on rules; the pane's tabs switch kind; toggling a rule and pressing apply changes the next `prompt.context`; a `Managed` row has no buttons; the large apply button is dimmed with its reason while a turn runs and without headspace-cut; the stale line appears with `staleCount`; narrow `bodyColumns` drops labels then counts.

### Task 9: save and undo

**Files:** `register.tsx`, `tests/register.test.ts` additions.

- `save(source)`: read the file from disk with `$.fs.read(path)`; parse with `parseRules`; apply this file's `applied` changes (off, edit, addLine; rule ids are computed on the disk text, so a rule whose text differs because of stripped comments or frontmatter simply does not match and the pane says `N changes cannot be saved: the rule differs on disk`); show `diffLines(disk, rendered)` and ask with `$.ui.ask('Save these changes to <path>?', ['Save', 'Cancel'])`; on Save: re-read the file, refuse if it changed since the first read (`changed on disk, nothing written`), push `{ at, text: disk }` to `$.store` `backup:<path>` (keep 10), write with `$.fs.write`, then drop this file's changes from `applied` (they are now in the file) and invalidate `prompt.context`.
- Session rule save: the person picks `project` (`<root>/CLAUDE.md`) or `user` (`~/.claude/CLAUDE.md`, from `$.session.root()` and the home in `$.fs` — grep for how to resolve home); append `- <rule>` under a `## Session rules` heading (create it at the end if absent); same backup and confirmation.
- `undoSave(source)`: pop the newest backup, write it back after `$.ui.ask` confirmation.
- `Managed` files: refused.

Tests: save writes the rendered text and a backup; the confirmation's diff lists the removed rule; Cancel writes nothing; a file changed between read and write is not written; undo restores and pops; ten-backup cap; Managed refused; session rule save creates the heading once and appends.

### Task 10: README and listing

**Files:** `mods/headspace/README.md`, `mods/headspace-cut/README.md` (if Task 1 left it short, fine), `README.md` (root): a row in the mods table and the install line `/plugin install headspace@emcc` (headspace-cut comes with it), `.claude-plugin/marketplace.json` entries (description, version 0.1.0, category development, tags `emcc`, `context`, `visual`).

`mods/headspace/README.md` sections: what it shows (the colour table from the spec), the hover and the pane, rules (session vs save, managed read-only), large results (apply, the stub line, no undo, the cache cost), the fallback `/compact headspace-cut:…`, what it never does (no model call, nothing sent anywhere, prompts and answers never removed), install. No images yet: the recordings come later.

### Task 11: real session check (the controller, after the workflow)

With VHS, `--plugin-dir mods/headspace --plugin-dir mods/headspace-cut`, Haiku: the band draws; `/headspace` opens the pane; turn a CLAUDE.md rule off and apply (the next answer ignores it); add a session rule (obeyed, and still after `/compact`); Read a big file, mark it, apply (stub read back, no summary). Hover checked by hand in Ghostty.
