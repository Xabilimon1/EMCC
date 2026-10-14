# headspace

What Claude carries, in colour, and what you can take out of it. Tested with **Claude Code 2.1.287**, terminal and desktop.

<!-- the recordings from Task 11 go here -->

Other context mods show how full the window is. headspace shows what fills it: the system prompt and tools, your rules, the conversation, and the big tool results that pile up without you noticing. Point at a piece and see what it is. Then take it out: a CLAUDE.md rule for this session, a session rule of your own, or a 40k `cat` from an hour ago. No model call, nothing summarized.

## What it shows

One line above the prompt: a bar with one segment per kind, each as wide as its share of the window, and the percentage used at the right.

| Kind | What it holds | Colour | Can be taken out |
|---|---|---|---|
| system | system prompt, system tools, MCP server instructions, MCP tools, custom agents, skills | stone `#b0aea5` | no, view only |
| rules | memory files (CLAUDE.md, rules files, auto-memory) and your session rules | clay `#d97757` | yes |
| conversation | messages, minus the large results | sky `#6a9bcc` | no, view only |
| large | tool results of `threshold` tokens or more (default 2000) | olive `#788c5d` | yes |
| free | free space | light `#e8e6dc`, dimmed | no |
| reserve | the autocompact buffer | stone, drawn `░` | no |

The figures are Claude Code's own estimate, the one `/context` shows; headspace makes no token-count calls. Tool schemas loaded on demand (`MCP tools (deferred)` and the like) are not in the window, so they are not in the bar. The bar refreshes when a turn ends and when the pane opens; a subagent's turn end does not count.

After the bar come labels, so a change is never forgotten: `rules 9.2k`, `2 off`, `large 16k`, `3 marked`, and `1 change no longer applies` when a rule you changed is no longer in its file.

On a narrow terminal the labels go first (under 100 columns), then the counts (under 70); the colours and the percentage stay, and every kind that holds anything keeps at least one cell.

With emcc-core or witness installed, their band is drawn under headspace's line, never replaced.

## The hover and the pane

- **Hover** a segment: it lights up, and in place of the labels a card says the kind, its tokens, how many pieces it holds, and what you can do (`click to view and remove`, or `view only`).
- **Click** a segment, or a label, to open the pane on that kind. From the keyboard: `ctrl+x tab` moves into the band's labels, and Enter opens the one in focus. The percentage opens the pane on rules.
- `/headspace` opens the pane on rules; `/headspace large` (or any other kind) on that kind.

The pane has the six kinds as tabs across the top, in their colours, and the selected kind's pieces below. Esc closes it. headspace never opens the pane on its own.

## Rules

The rules tab lists the files behind your CLAUDE.md context in the order Claude reads them (your user CLAUDE.md, the project's, rules files, `@` imports), then auto-memory, then your session rules:

```
rules  9.2k
~/.claude/CLAUDE.md  user  3.1k
save
● Commit messages follow Conventional…   410
○ Never push straight to main…           380
session rules  0.1k
● Keep the public API unchanged   remove  save
[ add a session rule ]
[ apply ]  rewrites ~148k of cache
```

A file splits into rules: each top-level list item with its continuation lines, or each paragraph. Select a rule to work on it:

- **off / on**: for this session only. Off is never deletion: turn it back on and apply.
- **edit** the selected line, or **add line** below it.
- Auto-memory entries (the index lines of your `MEMORY.md`) can only be turned off and on.

**Apply.** Changes wait until you press **apply** (or run `/headspace apply`), and take effect from the next request. Next to the button is what applying costs: `rewrites ~148k of cache`. Your rules sit in the first message of the conversation, so changing them means Claude Code sends everything after them again without the prompt cache. Turning off an auto-memory entry costs more: that index is part of the system prompt, which is sent again too.

**Session rules** are typed into the field at the bottom. They go into the context as a block of headspace's own, and they are still there after `/compact`, because headspace adds the block again whenever Claude Code rebuilds the context. **remove** takes one out; like every change, it waits for apply.

**Save to the file.** Changes made in the pane live only in this session until you save them. Each file has its own **save**: it shows the change line by line (`-` out, `+` in) and asks before writing. Before it writes, headspace keeps a copy of the file as it was, in Claude Code's storage for the plugin, never next to your CLAUDE.md, so no stray file lands in a repo. It keeps the last 10 saves per file. **undo save** puts the newest one back, after asking the same way.

- Save works on the file as it is on disk. A change whose rule reads differently there (Claude reads your files with comments and frontmatter stripped) is not saved, and the pane says how many.
- If the file changes on disk while you are being asked, nothing is written: `changed on disk, nothing written`.
- A session rule's **save** asks which CLAUDE.md, the project's or yours (`~/.claude/CLAUDE.md`, or the one under `CLAUDE_CONFIG_DIR`), and adds it as `- <rule>` under a `## Session rules` heading, made at the end of the file the first time.

**Read-only:** files of type `managed` (set by an organization) show their rules, marked `managed`, with no buttons. headspace never turns them off, edits or saves them.

## Large results

The large tab lists every tool result in what Claude currently reads that is `threshold` tokens or more, biggest first: the tool, its target in short (the file, the command, the URL), its size, and how many of your prompts came after it.

```
large  16.4k
[x] Read src/data.json  9.8k  14 turns ago  view
[x] Bash npm test  4.1k  3 turns ago  view
[ ] WebFetch docs.anthropic.com  2.5k  1 turn ago  view
[ apply ]  frees 13.9k, rewrites ~112k
```

**view** shows the first 20 lines of a result. The checkbox marks it.

**Apply** (or `/headspace cut`) removes the marked results. Each one becomes a single line in the conversation, and nothing else changes:

```
[headspace removed the result of Read src/data.json (9.8k tokens); run it again if you need it]
```

- It works only between turns. While Claude works, the button is dimmed and says so.
- Next to the button: the tokens it frees, and the cache it costs, which is everything from the first removed result to the end, sent again without the prompt cache. There is no dollar figure: the price per token depends on the model and your plan, and headspace does not know them.
- **There is no undo.** A removed result is gone from what Claude reads; Claude can run the tool again.
- Only tool results can be removed. Your prompts and Claude's answers never are, and neither is the turn in progress.
- Your transcript shows a compaction boundary, as `/compact` does.

The removal is a compaction answered by [`headspace-cut`](../headspace-cut), which installs with headspace: Claude Code never shows a plugin the compaction it started itself, so a second plugin answers it. Without headspace-cut (headspace loaded alone with `--plugin-dir`, or headspace-cut removed), apply is not offered and the pane says `install headspace-cut to remove results`. If headspace-cut cannot answer (a marked result is no longer there), it skips: the conversation stays as it is, the marks stay, and the pane shows why.

### The fallback: `/compact headspace-cut:…`

The same removal can be typed after `/compact`, without the pane:

```
/compact headspace-cut:{"marks":[{"id":"toolu_01AbC","label":"Read src/data.json (9.8k tokens)"}]}
```

`id` is the tool call's `tool_use_id`, as it appears in the session's transcript file; `label` is what the line left in its place names. Any other `/compact` works exactly as it does without headspace. See [headspace-cut](../headspace-cut) for what it answers and what it skips.

## What it never does

- No model calls. Everything is worked out from what Claude Code already has.
- Nothing is sent anywhere. No network, no processes.
- Your prompts and Claude's answers are never removed or changed.
- It writes a file only when you press save or undo save and confirm, and only that file.
- If one of its hooks fails, Claude Code's own context passes unchanged: nobody loses their rules to a bug. The pane then says `headspace lost track at <event>`.
- Without a context breakdown (a `-p` run), it draws nothing.

## Install

```
/plugin marketplace add Xabilimon1/emcc-claude-code-mods
/plugin install headspace@emcc
```

headspace-cut comes with it. headspace does not need emcc-core.

To try it without installing, load both folders:

```sh
claude --plugin-dir mods/headspace --plugin-dir mods/headspace-cut
```

## Commands

- `/headspace` opens the pane on rules. `/headspace <kind>` opens it on `rules`, `large`, `system`, `conversation`, `free` or `reserve`.
- `/headspace apply` applies the rule changes waiting, as the pane's apply does.
- `/headspace cut` removes the marked large results, as the pane's apply does.

## Options

Set them in `/config`, or at install with `--config key=value`.

| Option | Default | What it does |
|---|---|---|
| `threshold` | 2000 | Tool results of this many tokens or more show as large |

## What it hooks and calls

- Hooks: `session.start`, `turn.start`, `turn.complete`, `prompt.context` (rules turned off, edits, the session rules block), `prompt.section` (`memory`, auto-memory entries turned off), `command.run` (`headspace`), `ui.render` (`AbovePrompt`, the `headspace` pane)
- Calls: `$.session.usage`, `$.session.messages`, `$.session.cwd`, `$.session.root`, `$.session.compact`, `$.state.get`, `$.state.set`, `$.store.get` and `$.store.set` (the save backups), `$.fs.read`, `$.fs.exists` and `$.fs.write` (only the file being saved or restored), `$.env.get` (`HOME`, `CLAUDE_CONFIG_DIR`, to find your CLAUDE.md), `$.ui.open`, `$.ui.ask`, `$.ui.toast`, `$.ui.invalidate`, `$.ui.resolve`, `$.clock.now`, `$.clock.after`, `$.command.register`
- Kept after the session: only the save backups. No network, no processes, no model calls.

## Tests

```sh
claude plugin test mods/headspace
```

164 tests: the bar's kinds, widths and narrow fallbacks (24), rules parsed and rendered back byte for byte (38), auto-memory entries (12), large results, their cost and the removal instructions (17), the hooks, apply, removal, save and undo in a simulated session (50), and the band and the pane on both terminal and desktop (23). Each one was seen failing before it passed.
