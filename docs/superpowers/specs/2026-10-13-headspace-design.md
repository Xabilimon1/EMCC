# headspace: what Claude carries, in colour, and what you can take out

Status: approved design, 2026-10-13, revised after the spike the same day. A standalone EMCC mod: it does not need emcc-core. It ships as two plugins, `headspace` and `headspace-cut` (see Large results: why).

## Why

witness shows what Claude does. headspace shows what Claude carries while it does it: the system prompt and tools, your rules, the conversation, and the big tool results that fill the window without you noticing. Every context mod in the index (context-bar, context-meter, token-weather and more) only shows the fill. headspace lets you point at a piece, see what it is, and take it out: a rule for this session, or a 40k `cat` from an hour ago. Two things nobody does yet: a bar you interact with, and editing your CLAUDE.md rule by rule from a pane.

Mods that pin rules typed in chat already exist (pin-board, flowpane). headspace has that too, as one row of its rules list, because it fits there, not as its reason to exist.

## What the person sees

### The bar

Always above the prompt, one line: one segment per kind, its width proportional to the kind's tokens over the window, and the percentage used at the right.

| Kind | What it holds (from the `/context` breakdown) | Colour | Can be taken out |
|---|---|---|---|
| system | system prompt, system tools, MCP server instructions, MCP tools, custom agents, skills | stone `#b0aea5` | no, view only |
| rules | memory files (CLAUDE.md, rules files, auto-memory) and session rules | clay `#d97757` | yes |
| conversation | messages, minus the large results | sky `#6a9bcc` | no, view only |
| large | tool results of `threshold` tokens or more (default 2000) | olive `#788c5d` | yes |
| free | free space | light `#e8e6dc`, dimmed | no |
| reserve | the autocompact buffer | stone, drawn `░` | no |

Categories of kind `deferred` (tool schemas loaded on demand, such as `MCP tools (deferred)`) are not in the window and are left out of the bar.

- **Hover** lights the segment and shows a card above it: the kind's name, its tokens, how many pieces it holds, and what can be done (`click to view and remove`, or `view only`). Hover is the engine's own (`hover` on a keyed `Box`, an absolutely placed card revealed with `display: 'flex'`): no hook runs.
- **Pressing** a segment, with the pointer or from the keyboard (ctrl+x tab into the band, ← → between segments, Enter), opens the pane on that kind. `/headspace` opens it on rules.
- **Changes show on the bar** so they are never forgotten: `rules 9.2k  2 off`, `large 16k  3 marked`, `1 change no longer applies`.
- **Narrow terminals:** the labels go first, then the counts; colours and percentage stay. Every non-empty segment keeps at least one cell.
- **Refresh:** at every turn end and when the pane opens, with `$.session.usage({ breakdown: 'summary' })`, the local estimate. No token-count API calls.
- headspace never opens the pane on its own.

### The pane

The same colours across the top as tabs; the selected kind's pieces below; Esc closes. All text in the mod is English, like the rest of EMCC.

### Rules

Where they come from: the `prompt.context` hook receives the `claudeMd` block and `instructionFiles`, the files behind it in render order with `@` imports, each with its path, tier (`kind`) and text. That text is the file as loaded, with comments and frontmatter already stripped, so it is what turning a rule off works on; saving works on the file read from disk. Auto-memory is not in `claudeMd`: it rides in the system prompt section `memory` (seen in the spike). The pane groups them by file (user CLAUDE.md, project CLAUDE.md, rules files, auto-memory) plus a group of session rules.

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

**Session rules** are typed into the field and go into the context as a block of headspace's own (`sessionRules`). The engine computes the context blocks again after a compaction or `/clear`, and headspace's hook adds the block again, so they survive `/compact`. Seen in the spike: a block telling Haiku to end every answer with a word was obeyed before and after `/compact`.

**Save to the file.** One **save** per file: it shows the change line by line (out and in) and asks to confirm. Before writing, it keeps a copy of the original in `$.store` (the last 10 saves per file), never next to your CLAUDE.md, so no stray file lands in a repo. **Undo last save** restores it. A session rule can be saved into the project's CLAUDE.md or into the user's; the person chooses which.

**Read-only:** files of type `Managed` (an organization's) show, but cannot be turned off, edited or saved.

**Auto-memory** is turned off entry by entry through a `prompt.section` hook on `{ name: 'memory' }`, which rewrites the section's text without the entries turned off. The section also carries the engine's instructions on how to use memory; those are left alone. The person sees the same rows as for a file.

### Large results

Found in the live conversation: every tool result whose estimated size is `threshold` tokens or more. `$.session.messages()` also returns the rows from before the last compaction (seen in the spike), so the rows the model no longer reads are left out first; which call or marker draws that line is the plan's first check. The breakdown's own estimate of Messages does not match a characters-over-four estimate (a 36k-character Read counted for about 4k tokens of Messages in the spike), so large takes its share of the Messages figure in proportion to characters and never exceeds it.

```
large  16.4k                          2 marked
[x] Read  src/data.json          9.8k   14 turns ago
[x] Bash  npm test               4.1k    3 turns ago
[ ] WebFetch docs.anthropic.com  2.5k    1 turn ago

[ apply ]  frees 13.9k, rewrites ~112k of cache
```

Biggest first; each row the tool, its target in short (file, command, URL), size and age in turns. **view** shows its first 20 lines; a checkbox marks it.

**Apply** works only between turns: while Claude works the button is dimmed and says so. Pressing it calls `$.session.compact({ instructions })`, where `instructions` is `headspace-cut:` followed by the marked results' `tool_use_id`s as JSON.

**Why a second plugin.** The spike showed that a plugin's own `session.compact` hooks never see a compaction that plugin started (from a button press or a timer alike); the engine then ran its normal summary. And the call is refused outright from a `command.run` hook (`it would compact under the turn this hook is holding`). So the answer lives in `headspace-cut`, a plugin with one hook that headspace lists under `"dependencies"`, so installing headspace installs it. The spike's two-plugin run worked: the companion answered, the result was replaced, there was no summary, and Haiku, asked without tools, said the result had been removed.

`headspace-cut` answers only a compaction whose `instructions` start with `headspace-cut:`, trigger `plugin` (the button) or `manual` (the same text typed after `/compact`, which also works and is the fallback the README gives). It answers without `next`: every message as it was, with its `handle`, except the marked results, rebuilt without a handle, their content one line:

```
[headspace removed the result of Read src/data.json (9.8k tokens); run it again if you need it]
```

No summary, no model call. The person's transcript shows the compaction boundary, as `/compact` does. The cost shown is the tokens from the first removed result to the end, the part that is cached again. No dollar figure: the price per token depends on the model and the plan, and headspace does not know it.

There is no undo: the confirmation says so. Only tool results can be removed; the person's prompts and Claude's answers cannot, and the turn in progress is never touched.

## Architecture

`mods/headspace/`, the same layout as witness. `plugin.json` lists `headspace-cut` under `"dependencies"` and has one `userConfig` field, `threshold` (tokens, default 2000). `mods/headspace-cut/` holds one `session.compact` hook and the pure function that rebuilds the message list.

Pure functions, no `$`, each tested on its own:

- `hooks/bar.ts`: the breakdown's categories into the six kinds, large moved out of conversation, widths with the one-cell minimum, the narrow-terminal fallbacks.
- `hooks/rules.ts`: a file into headings and rules; back into text with rules off, edited or added; the line diff a save shows. Rendering a file with no changes returns it byte for byte.
- `hooks/large.ts`: the large results from a message list, their estimated tokens, short target and age; the cache cost of an apply; the `instructions` text an apply sends.
- `headspace-cut/hooks/cut.ts`: reads that text back and builds the stubbed message list.

`hooks/register.tsx`:

| Hook | What it does |
|---|---|
| `session.start` | registers `/headspace` |
| `turn.complete` | refreshes the bar (main loop only; a subagent's turn end is ignored) |
| `prompt.context` | turns rules off, applies edits, adds the `sessionRules` block |
| `prompt.section` | on `memory`: the same for auto-memory |
| `ui.render` | `AbovePrompt` (the bar with its hover cards) and `Pane` (`headspace`) |
| `command.run` | `/headspace` opens the pane |

**State.** Session (`$.state`, declared in `types/index.d.ts`): the bar's last snapshot, the rule changes (pending and applied), the session rules, the marked results, and whether an apply is in flight. Across sessions (`$.store`): the save backups.

**A rule's identity** is file, heading, position and a hash of its text. When the file changes on disk, a change that no longer matches is dropped, and the bar says so.

## Failure handling

Every hook body is wrapped, and every failure falls to the safe side:

- `prompt.context` fails: core's blocks pass unchanged. Nobody loses their rules to a bug.
- Anything unexpected while `headspace-cut` answers a compaction (unreadable instructions, a marked result no longer there): answer `{ skip }` and the conversation stays as it is. Never fall through to `next(e)`, which would summarize when nobody asked for it.
- `headspace-cut` missing (installed with `--plugin-dir` alone, or removed): apply is not offered, and the pane says why. Without this check the button would start a normal summary.
- Save finds the file changed on disk since it was read: nothing is written, and the pane says so.
- No breakdown available (a `-p` run, no bound session): no bar.
- The pane shows `headspace lost track at <event>` instead of breaking.

## Tests

All with `claude plugin test`, each seen failing before it passes, by breaking the code it checks.

- **Pure:** a file rendered with no changes is identical byte for byte (several real CLAUDE.md shapes: headings, nested lists, code fences, `@` imports); off, edit, add line; widths and the one-cell minimum; the narrow fallbacks; the threshold; the stub line; the cache cost.
- **Simulated session:** the bar draws the six colours; each segment carries its hover card; pressing a segment opens the pane on its kind; apply on rules changes the `claudeMd` block and adds `sessionRules`; apply on large sends the `headspace-cut:` instructions; `headspace-cut` returns the messages with the stub and no summary, skips on unreadable instructions, and passes any other compaction untouched; apply is dimmed while a turn runs and not offered without `headspace-cut`; `Managed` is read-only; save writes the file and the backup, undo restores it; save refuses a file changed on disk; a throwing hook leaves core's answer unchanged.

## What the spike settled

Three runs on 2026-10-13, Claude Code 2.1.287, Haiku 4.5, `--plugin-dir`, a throwaway mod:

1. A compaction answer of rebuilt messages is accepted, and the model reads the stub afterwards. But only from another plugin: hence `headspace-cut`. From `command.run` the call is refused.
2. Auto-memory rides in the `memory` system prompt section, not in `claudeMd`.
3. A plugin's own context block is there again after `/compact`.
4. The bar's colours and a band button draw as designed. Hover could not be checked: VHS has no pointer. It is checked by hand in Ghostty before the release.

Still open for the plan's first task: how to tell the live rows from those before the last compaction in `$.session.messages()`.

## Out of scope

- Hiding MCP tools, skills or agents from the listing.
- Removing the person's prompts or Claude's answers.
- Any model call. headspace is deterministic and free.
- Workflow views: later, as part of witness (one lane per workflow agent, each with its proof mark).
