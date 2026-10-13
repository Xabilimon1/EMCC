# witness: a live view of Claude's work, and proof of it

Status: approved design, 2026-10-13. First piece of the EMCC Trust kit.

## Why

Mods that let you watch what Claude is doing are the ones that draw attention, and the mod index already has many of them: flight-recorder (a Gantt of a turn), repo-heatmap, plan-progress, where-am-i. None of them answers the question a person working with Claude has all day: can I trust what it did, and what do I still have to check myself?

witness shows Claude working live, the same as those mods do, and marks next to each step whether it is proven, unproven, or proven before later edits. goalpost-guard moves inside it: a lowered bar shows as a mark on the step instead of a dialog.

The rest of the Trust kit (review-debt, review-radar, a proof card for pull requests) gets its own design later. All of it reads the same evidence through emcc-core.

## What the person sees

A pane, top to bottom:

1. **Goal.** The first sentence of the prompt, on one line (`wrap="truncate-end"`: an ellipsis when it is long), with a right margin of 3 columns so it never reaches the pane's close mark in the top-right corner. What the person types after Claude Code's `/goal` replaces it.
2. **Phase ribbon.** A bar that grows as Claude works. Each segment's width is the time spent in that phase:

   | Phase | When | Colour |
   |---|---|---|
   | explore | reads a file, or runs a read-only shell command (`rg`, `grep`, `ls`, `cat`, `find`, `git log`, `git diff`, `git show`, `git status`) | sky `#6a9bcc` |
   | implement | Edit, Write, NotebookEdit | olive `#788c5d` |
   | debug | an edit made after a test, build, lint or typecheck failed, until one passes again | clay `#d97757` |
   | verify | runs a test, build, lint or typecheck | light `#e8e6dc` |
   | waiting | the turn ended and it is the person's move | stone `#b0aea5`, dimmed |

   Other tools count toward the phase in progress. Under the ribbon, each phase's name and total time.
3. **Now.** The action in progress, on one line with a dot that pulses once a second: `edits src/cart.js +3 −1`, `runs npm test…`. Empty between actions.
4. **Steps.** Claude's task list, from its `TaskCreate` and `TaskUpdate` calls, newest last:

   | Mark | Meaning |
   |---|---|
   | `✓` olive | Completed and **proven**: a test, build or typecheck passed after the step's last edit. Shows which command and when. |
   | `○` stone | Completed with **no proof**: nothing ran after its edits, or nothing ran at all. |
   | `◌` stone | **Proof went stale**: a check passed, then the step's files were edited again. Shows "proven before N edits". |
   | `▲` clay | A **lowered bar** was flagged while the step was in progress (goalpost-guard, or any mod that flags). A step that never went `in_progress` is never flagged: Claude often creates every task up front, and a flag must not spread to steps that were not running. The step never counts as proven while it carries a flag, even if checks pass afterwards: a passing check cannot tell a fixed test from a lowered one. Shows the flag's text. |
   | `·` | Pending. The step in progress is highlighted. |

   A step's edits are the Edit, Write and NotebookEdit calls made while it was `in_progress`; edits made while no step is in progress belong to none. A completed step with no edits of its own is judged by the newest check after the step began, and a step that never went `in_progress` began when it was created.

### /goal

`/goal` is Claude Code's built-in ("Set a goal Claude checks before stopping"; seen in 2.1.287). witness does not register its own: in a real session `$.command.register({ name: 'goal' })` is refused (`"/goal" refused: it is the built-in /goal`), and a hook that answered `/goal` without `next` would silently replace the built-in. Instead a `command.run` hook on `{ command: 'goal' }` reads `e.args` (a hook sees built-in commands too), updates witness's goal and criteria, and always returns `next(e)` unchanged and exactly once, so the built-in runs and its answer is what the person sees. A failure in witness's part is recorded (`lostAt: /goal`) and `next(e)` still runs.

What witness reads is what is typed after `/goal` in this session. Criteria follow "done when" (or "hecho cuando"), separated by `;`:

```
/goal fix withTax rounding; done when `npm test` passes; the README shows the new rate
```

- A criterion with a command in backticks is proven when that exact command (whitespace collapsed) passed after the newest edit of the session. It turns stale the same way a step does. If a lowered bar was flagged after the goal was set and at or before that passing run, the criterion shows `▲` instead of `✓`.
- A criterion without a command is ticked by the person: the pane lists criteria with hotkeys `1`–`9`.
- Without "done when", the whole text is the goal and there are no criteria.
- `/goal` with no text changes nothing in witness: what the built-in does with empty args is its own, and witness does not guess it.
- A goal set before witness was loaded, or in an earlier session, is not seen. witness has no way to ask the built-in for its current goal.

Criteria are drawn above the steps when they exist.

### When it shows

- On the first tool call of a session, witness calls `$.ui.open({ id: 'witness', title: 'witness', closeOnEscape: true })`. The engine places a pane opened unasked from 144 terminal columns, and from 110 once the person has opened it themselves.
- When the pane is not placed (narrow terminal), a line above the prompt reads `Live view · 2/4 proven` with a **Live** button. With emcc-core it is a badge in the EMCC band; without it, witness draws its own line, as goalpost-guard does.
- `/live` opens the pane at any width. Esc closes it. `p` in the pane, or `/live pause`, pauses witness for the session, and `/live resume` brings it back.
- The same tree draws on the terminal and the desktop Code tab: Box, Text and Button only, no Raster.

## Architecture

Three mods, each doing one thing.

### emcc-core 0.2.0: the evidence log gains flags

It already records every test, build, lint and typecheck with its outcome, and every edit with its file (`evidenceLatest`, `evidenceSince`). New:

```ts
export type EmccFlag = {
  source: string        // the mod that flagged, e.g. 'goalpost-guard'
  rule: string          // e.g. 'tests.expected'
  file?: string
  text: string          // one line for people, e.g. 'changes the values in 1 assertion'
  at: number            // session clock, ms
}

flag: (input: Omit<EmccFlag, 'at'>) => Promise<void>
flagsSince: (input: { at: number }) => Promise<EmccFlag[]>
```

Flags live in session state next to the evidence, capped like it.

### goalpost-guard 0.2.0: report instead of ask, with emcc-core

`mode` keeps its values. What `inherit` resolves to changes:

| emcc-core | Profile | Before | Now |
|---|---|---|---|
| installed | standard, a screen exists | ask | **warn**, and flag |
| installed | standard, no screen | ask | ask, so `headless` applies (deny by default) |
| installed | strict | deny | deny, not flagged |
| installed | off | off | off |
| not installed | (none) | ask | ask |

- `warn` already lets the change through, records it in the ledger and tells Claude to report it. It now also calls `$.emcc.flag`.
- Only a bar that was lowered is flagged (`warned`, `allowed`, `excepted`). A held change lowered nothing, so it is not flagged; the ledger shows it.
- Explicit `mode=ask` keeps the dialog with the kit.
- Ledger, exceptions, trailers and audit are unchanged.

### witness 0.1.0: watch and draw

`plugin.json` lists `emcc-core` under `"dependencies"`, so installing witness installs emcc-core (the CLI's `prune` command removes auto-installed dependencies; to be confirmed in the real install).

| Hook | What it takes |
|---|---|
| `session.start` | registers `/live` (not `/goal`, which is the built-in's) |
| `prompt.submit` | the goal from the prompt's first sentence, unless a `/goal` typed in this session set one |
| `tool.call` (every tool) | before `next`: sets Now, opens the pane on the first call. After `next`: closes the ribbon segment with its phase and duration, clears Now. `TaskCreate` (id from the result text `Task #N created`) and `TaskUpdate` (`taskId`, `status`, `subject`) maintain the steps. Edit, Write and NotebookEdit are attributed to the step in progress. |
| `turn.complete` | opens a waiting segment |
| `command.run` | `/live`, `/live pause`, `/live resume`; and `/goal`, which it only reads and then passes on with `next(e)` |
| `ui.render` | `Pane` (`witness`) and `AbovePrompt` (only without emcc-core) |

**Marks are computed while drawing, never stored.** For each step: its edits, then `$.emcc.evidenceSince` and `$.emcc.flagsSince` from when the step began. A mark cannot go stale in storage because none is stored.

The phase classifier and the mark calculation are pure functions in their own files (`hooks/phases.ts`, `hooks/marks.ts`), with no `$`.

**Session state** (`$.state`, declared in `types/index.d.ts`): goal (and when `/goal` set it), criteria (with ticks), steps (id, subject, status, createdAt, startedAt, completedAt), edits and shell runs (each with its time; an edit names the step in progress), ribbon segments (at most 200; the oldest merge into one), running totals per phase (kept apart from the segments, so merging never shifts time between phases), now, isPaused. Nothing is written to disk, nothing goes over the network.

**The pulse** uses `$.clock.every(1000, …)`, started when an action begins and stopped when it ends or the pane closes.

### Installing the kit

witness installs emcc-core through its dependency. The README gives goalpost-guard as the second line. A `trust-kit` plugin that only depends on witness and goalpost-guard is worth trying once dependencies are confirmed to install from the marketplace.

## Edge cases settled in review

- **Whose prompt.** The goal comes only from the person's prompts (origins `composer`, `bridge`, `sdk`; no origin counts as the person). Task notifications, scheduled triggers and messages from other sessions never become the goal. A slash command, or a prompt delivered into a running turn, does not end the waiting stretch either.
- **Subagents.** A subagent's turn end is ignored; its tool calls count as Claude's work.
- **Parallel calls.** The ribbon's bookkeeping runs one call at a time, each with the time it really ended. Now shows the newest call and clears when the last one ends.
- **Turn end.** The stretch from the last call to the end of the turn goes to the phase of the work, then waiting starts. A call with no phase of its own continues the work's phase, never waiting.
- **Background and denied calls.** A shell command sent to the background proves nothing and records no run. A denied call keeps the time it took on the ribbon and records nothing else.
- **Which step an edit belongs to.** The in-progress step started last. Each step keeps the files it edited, so a long session trimming old edits cannot turn its proof stale.
- **Pausing** closes the waiting stretch at that moment; resuming starts the ribbon again from then. Paused time belongs to no phase.

## Failure handling

- witness only observes. Every hook body is wrapped: on an exception, the tool call goes on unchanged (`next(e)`'s result is returned as is), and the pane shows `witness lost track at <event>` instead of breaking.
- If `$.emcc` is missing or throws, the pane still shows goal, ribbon, Now and steps. Where the marks go it says `install emcc-core to see proof` and invents none.
- A `TaskCreate` result with no readable id adds a step without an id; its updates cannot reach it, and nothing else is lost.
- More than 200 segments: the oldest merge. Steps beyond the pane's height scroll with ↑/↓.
- The pulse stops when the pane is closed or nothing is in progress.

## Tests

All with `claude plugin test`, each seen failing before it passes by breaking the code it checks.

- **witness, pure:** the phase classifier (each tool and outcome to its phase, read-only shell commands, debug after a failure until a pass); the marks (`✓ ○ ◌ ▲ ·`, a step with no edits, a `▲` that stays after a later pass, edits outside any step); `/goal` parsing (criteria, backticks, no "done when", clearing).
- **witness, simulated session:** a sequence of tool calls ends with the pane showing the expected goal, ribbon labels, Now and marks; the pane opens on the first tool call; a narrow terminal gets the Live line; without emcc-core the notice shows; the desktop surface draws the same tree; a throwing hook leaves the tool call's result unchanged.
- **goalpost-guard:** with emcc-core, standard lets the change through, flags it and tells Claude; strict denies and does not flag; with no screen `inherit` asks, so `headless` applies; without emcc-core it asks. The 78 current tests stay green, adjusted only where `inherit` now resolves differently.
- **emcc-core:** `flag` then `flagsSince` returns it; flags before `at` are left out; the cap holds.

## The recording

A new VHS scene, `scene-live.tape`: Haiku fixes the cart with a task list. The ribbon grows, steps turn `✓`, and one turns `▲` when it tries to lower the test. The pane only opens unasked from 144 columns and the current recordings are about 130 wide, so the scene runs wider (or one point smaller). Its GIF becomes the main README's hero; goalpost-guard's GIF moves to its own section.

## Out of scope

- review-debt, review-radar, the proof card, drift-line, constellation: later designs.
- Any model call. witness is deterministic and free.
- Persisting anything across sessions.
