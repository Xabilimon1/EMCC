# headspace: what Claude carries, in colour, and what you can take out

Status: approved design, 2026-10-13. A standalone EMCC mod: it does not need emcc-core.

## Why

witness shows what Claude does. headspace shows what Claude carries while it does it: the system prompt and tools, your rules, the conversation, and the big tool results that fill the window without you noticing. Every context mod in the index (context-bar, context-meter, token-weather and more) only shows the fill. headspace lets you point at a piece, see what it is, and take it out: a rule for this session, or a 40k `cat` from an hour ago. Two things nobody does yet: a bar you interact with, and editing your CLAUDE.md rule by rule from a pane.

Mods that pin rules typed in chat already exist (pin-board, flowpane). headspace has that too, as one row of its rules list, because it fits there, not as its reason to exist.

## What the person sees

### The bar

Always above the prompt, one line: one segment per kind, its width proportional to the kind's tokens over the window, and the percentage used at the right.

| Kind | What it holds (from the `/context` breakdown) | Colour | Can be taken out |
|---|---|---|---|
| system | system prompt, system tools, MCP tools, custom agents, skills | stone `#b0aea5` | no, view only |
| rules | memory files (CLAUDE.md, rules files, auto-memory) and session rules | clay `#d97757` | yes |
| conversation | messages, minus the large results | sky `#6a9bcc` | no, view only |
| large | tool results of `threshold` tokens or more (default 2000) | olive `#788c5d` | yes |
| free | free space | light `#e8e6dc`, dimmed | no |
| reserve | the autocompact buffer | stone, drawn `░` | no |

- **Hover** lights the segment and shows a card above it: the kind's name, its tokens, how many pieces it holds, and what can be done (`click to view and remove`, or `view only`). Hover is the engine's own (`hover` on a keyed `Box`, an absolutely placed card revealed with `display: 'flex'`): no hook runs.
- **Pressing** a segment, with the pointer or from the keyboard (ctrl+x tab into the band, ← → between segments, Enter), opens the pane on that kind. `/headspace` opens it on rules.
- **Changes show on the bar** so they are never forgotten: `rules 9.2k  2 off`, `large 16k  3 marked`, `1 change no longer applies`.
- **Narrow terminals:** the labels go first, then the counts; colours and percentage stay. Every non-empty segment keeps at least one cell.
- **Refresh:** at every turn end and when the pane opens, with `$.session.usage({ breakdown: 'summary' })`, the local estimate. No token-count API calls.
- headspace never opens the pane on its own.

### The pane

The same colours across the top as tabs; the selected kind's pieces below; Esc closes. All text in the mod is English, like the rest of EMCC.

### Rules

Where they come from: the `prompt.context` hook receives the `claudeMd` block and `instructionFiles`, the files behind it in render order with `@` imports, each with its path and text. The pane groups them by file (user CLAUDE.md, project CLAUDE.md, rules files, auto-memory) plus a group of session rules.

A file splits into headings (`#` lines) and, under each, rules: each top-level list item with its continuation lines, or each paragraph.

```
rules  9.2k                            2 off
▾ ~/.claude/CLAUDE.md          user    3.1k
  # Git
    ● Commit messages follow Conventional…   410
    ○ Never push straight to main…           380   (off)
▸ CLAUDE.md                    project 1.4k
▸ MEMORY.md                    auto    4.7k
▾ session rules                        0.1k
    ● Keep the public API unchanged
  [ add a session rule ____________________ ]
```

Per rule: **on / off** (this session), **edit** a line (the engine's one-line `Input`), **add a line** below the selected one, **view** the whole rule.

**Apply.** Changes pend until **apply**, which first shows what it costs: `rewrites ~148k of cache`. Rules live in the first user message, so changing them re-caches the whole conversation. They take effect from the next request, via `$.ui.invalidate('prompt.context')`. Off is never deletion: turn it back on and apply.

**Session rules** are typed into the field and go into the context as a block of headspace's own (`sessionRules`). The engine computes the context blocks again after a compaction or `/clear`, and headspace's hook adds the block again, so they survive `/compact`.

**Save to the file.** One **save** per file: it shows the change line by line (out and in) and asks to confirm. Before writing, it keeps a copy of the original in `$.store` (the last 10 saves per file), never next to your CLAUDE.md, so no stray file lands in a repo. **Undo last save** restores it. A session rule can be saved into the project's CLAUDE.md or into the user's; the person chooses which.

**Read-only:** files of type `Managed` (an organization's) show, but cannot be turned off, edited or saved.

**Auto-memory.** If the auto-memory index turns out not to ride in `claudeMd` but in a system prompt section of its own, it is turned off through `prompt.section` instead; the person sees the same rows. Settled by the spike below.

### Large results

Found in `$.session.messages()`: every tool result whose estimated size is `threshold` tokens or more. Their tokens move from conversation to large in the bar.

```
large  16.4k                          2 marked
[x] Read  src/data.json          9.8k   14 turns ago
[x] Bash  npm test               4.1k    3 turns ago
[ ] WebFetch docs.anthropic.com  2.5k    1 turn ago

[ apply ]  frees 13.9k, rewrites ~112k of cache
```

Biggest first; each row the tool, its target in short (file, command, URL), size and age in turns. **view** shows its first 20 lines; a checkbox marks it.

**Apply** works only between turns: while Claude works the button is dimmed and says so. Pressing it calls `$.session.compact()`. The engine skips only the calling hook, so headspace's own `session.compact` hook sees the event (trigger `plugin`, `next.origin` headspace) and answers it without `next`: every message as it was, with its `handle`, except the marked results, whose content becomes one line:

```
[headspace removed the result of Read src/data.json (9.8k tokens); run it again if you need it]
```

No summary, no model call. The person's transcript shows the compaction boundary, as `/compact` does. The cost shown is the tokens from the first removed result to the end, the part that is cached again. No dollar figure: the price per token depends on the model and the plan, and headspace does not know it.

There is no undo: the confirmation says so. Only tool results can be removed; the person's prompts and Claude's answers cannot, and the turn in progress is never touched.

## Architecture

`mods/headspace/`, the same layout as witness. `plugin.json` has no dependencies and one `userConfig` field, `threshold` (tokens, default 2000).

Pure functions, no `$`, each tested on its own:

- `hooks/bar.ts`: the breakdown's categories into the six kinds, large moved out of conversation, widths with the one-cell minimum, the narrow-terminal fallbacks.
- `hooks/rules.ts`: a file into headings and rules; back into text with rules off, edited or added; the line diff a save shows. Rendering a file with no changes returns it byte for byte.
- `hooks/large.ts`: the large results from a message list, their estimated tokens, short target and age; the stubbed message list; the cache cost of an apply.

`hooks/register.tsx`:

| Hook | What it does |
|---|---|
| `session.start` | registers `/headspace` |
| `turn.complete` | refreshes the bar (main loop only; a subagent's turn end is ignored) |
| `prompt.context` | turns rules off, applies edits, adds the `sessionRules` block |
| `prompt.section` | the same for auto-memory, if the spike puts it there |
| `session.compact` | answers only the compaction headspace started; any other passes with `next(e)` untouched |
| `ui.render` | `AbovePrompt` (the bar with its hover cards) and `Pane` (`headspace`) |
| `command.run` | `/headspace` opens the pane |

**State.** Session (`$.state`, declared in `types/index.d.ts`): the bar's last snapshot, the rule changes (pending and applied), the session rules, the marked results, and whether an apply is in flight. Across sessions (`$.store`): the save backups.

**A rule's identity** is file, heading, position and a hash of its text. When the file changes on disk, a change that no longer matches is dropped, and the bar says so.

## Failure handling

Every hook body is wrapped, and every failure falls to the safe side:

- `prompt.context` fails: core's blocks pass unchanged. Nobody loses their rules to a bug.
- Anything unexpected while answering a compaction (a marked result no longer there, handles that do not line up): answer `{ skip }` and the conversation stays as it is. Never fall through to `next(e)`, which would summarize when nobody asked for it.
- Save finds the file changed on disk since it was read: nothing is written, and the pane says so.
- No breakdown available (a `-p` run, no bound session): no bar.
- The pane shows `headspace lost track at <event>` instead of breaking.

## Tests

All with `claude plugin test`, each seen failing before it passes, by breaking the code it checks.

- **Pure:** a file rendered with no changes is identical byte for byte (several real CLAUDE.md shapes: headings, nested lists, code fences, `@` imports); off, edit, add line; widths and the one-cell minimum; the narrow fallbacks; the threshold; the stub line; the cache cost.
- **Simulated session:** the bar draws the six colours; each segment carries its hover card; pressing a segment opens the pane on its kind; apply on rules changes the `claudeMd` block and adds `sessionRules`; apply on large returns the messages with the stub and no summary; apply is dimmed while a turn runs; a compaction headspace did not start passes untouched; `Managed` is read-only; save writes the file and the backup, undo restores it; save refuses a file changed on disk; a throwing hook leaves core's answer unchanged.

## Spike before the plan

In a real session with `--plugin-dir` and a throwaway mod:

1. The engine accepts a `session.compact` answer of rebuilt messages, the unchanged ones with their `handle`, and the transcript shows them afterwards.
2. Where auto-memory rides: `claudeMd` or a `prompt.section`.
3. A `prompt.context` block of a plugin's own is there again after `/compact`.
4. Hover lights a segment and reveals its card in Ghostty.

If one fails, this spec changes before the plan is written.

## Out of scope

- Hiding MCP tools, skills or agents from the listing.
- Removing the person's prompts or Claude's answers.
- Any model call. headspace is deterministic and free.
- Workflow views: later, as part of witness (one lane per workflow agent, each with its proof mark).
