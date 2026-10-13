# witness

A live view of Claude's work, and proof of it. Tested with **Claude Code 2.1.287**, terminal and desktop.

<!-- the GIF from Task 11 goes here -->

Other mods show what Claude is doing. witness also marks each step of Claude's task list with whether a test, build or typecheck proved it, and keeps that mark honest as the session goes on: an edit after the proof makes it stale, and a lowered bar that goalpost-guard let through means the step is never counted as proven.

## What it shows

A pane, top to bottom:

- **Goal**: the first sentence of your prompt (up to 100 characters), or what you set with `/goal`. Only your own prompts count: a task notification or a message from another session never becomes the goal.
- **Ribbon**: where the time went, as it happens, each phase's share of the bar by time, and each phase's total under it:

  | Phase | When |
  |---|---|
  | explore | reads, searches and read-only shell commands (`rg`, `grep`, `ls`, `cat`, `find`, `git log`, `git diff`, `git status`…) |
  | implement | `Edit`, `Write`, `NotebookEdit` |
  | debug | an edit after a test, build, lint or typecheck failed, until one passes again |
  | verify | a test, build, lint or typecheck run, as emcc-core classifies the command |
  | waiting | the turn ended and it is your move |

  Any other tool counts toward the phase in progress.
- **Now**: the action in progress (`edits src/cart.js +1 −1`, `runs npm test`), with a dot that pulses once a second. `Now idle` between actions.
- **Criteria**, when `/goal` set some (see below).
- **Steps**: Claude's task list, from its `TaskCreate` and `TaskUpdate` calls, each marked:

| Mark | Means |
|---|---|
| `✓` | Proven: a test, build or typecheck passed since the step began, with no edit after it to the step's files (to any file, for a step that edited none). Shows which command and how long ago (`npm test passed 3m ago`) |
| `○` | No proof: nothing passed since the step began |
| `◌` | Proven before N edits: those edits came after its last passing check |
| `▲` | A lowered bar was flagged while the step was in progress (goalpost-guard). It never counts as proven, even if checks pass later. Shows the flag's text |
| `·` | Pending, or in progress (in bold) |

A step's edits are the ones made while it was in progress; with several in progress, the one started last. Marks are worked out each time the pane draws, from emcc-core's evidence, never stored. Without emcc-core the pane still shows the goal, the ribbon, Now and the steps, and says `install emcc-core to see proof` where the marks would be.

## Where it shows

- The pane opens by itself on Claude's first tool call. Claude Code places a pane opened that way only on a terminal 144 columns wide or more; on a narrower one it waits, and appears if the terminal widens.
- While the pane is not on screen (a narrow terminal, or you closed it), the count stays above the prompt: in the EMCC band as `witness 2/4 proven, /live`, or, without emcc-core (or with its profile `off`), as its own line `witness 2/4 proven` with a **Live** button. Criteria count too, proven or ticked.
- Closing the pane stops the pulse, and the badge or the line comes back.

## Install

```
/plugin marketplace add Xabilimon1/emcc-claude-code-mods
/plugin install witness@emcc
/plugin install goalpost-guard@emcc
```

witness needs [`emcc-core`](../emcc-core), which keeps the evidence it marks steps with; installing witness installs it. [`goalpost-guard`](../goalpost-guard) is optional: with it, a lowered bar shows as `▲`.

## Commands

- `/live` opens the pane, at any width. `/live pause` stops watching for this session, and `/live resume` starts again; the ribbon picks up from the resume, so paused time belongs to no phase.
- `/goal <goal>; done when <criterion>; <criterion>` sets the goal (`hecho cuando` works too). A criterion with a command in backticks is proven when that command passes with no edit after it; it shows `✗` if its newest run failed, `◌` after an edit, and `▲` if a lowered bar was flagged after `/goal` and before the run that passed. A criterion without a command is ticked by you, with its number key.
- `/goal done when <criterion>` sets criteria only, and the goal keeps following your prompt.
- `/goal` alone clears the goal and its criteria, and the goal follows your prompt again.
- In the pane: `p` pauses and resumes, `1` to `9` tick or untick the criteria without a command, Esc closes.

## What it hooks and calls

- Hooks: `session.start`, `prompt.submit`, `tool.call` (every tool, before and after it runs, never changing it), `turn.complete`, `command.run` (`live`, `goal`), `ui.close` (its pane), `ui.render` (the `witness` pane, `AbovePrompt`)
- Calls: `$.clock.now`, `$.clock.every`, `$.session.cwd`, `$.command.register`, `$.ui.open`, `$.ui.panes`, `$.ui.resolve`, `$.state.get`, `$.state.set`, `$.emcc.evidenceSince`, `$.emcc.flagsSince`, `$.emcc.kindsOf`, `$.emcc.badge`, `$.emcc.profile`, `$.emcc.isHalted`
- Nothing is kept after the session. No network, no files, no processes, no model calls.

## Tests

```sh
claude plugin test mods/witness
```

109 tests: goal parsing (8), phases (14), marks (15), watching a session (41), and the pane, the band and the pulse on both terminal and desktop (31). Each one was seen failing before it passed.
