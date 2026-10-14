# headspace-cut

headspace's companion. When you take large tool results out of the conversation in [headspace](../headspace), headspace starts a compaction and this plugin answers it: each marked result becomes one line, every other message stays exactly as it was, and nothing is summarized. No model call is made.

```
[headspace removed the result of Read src/data.json (9.8k tokens); run it again if you need it]
```

## Why a separate plugin

Claude Code never shows a plugin the compaction that plugin started itself; the engine would run its normal summary instead. So the answer lives here, and headspace lists `headspace-cut` under its `dependencies`: installing headspace installs this too. You do not install it on its own.

## What it answers

Only a compaction whose instructions start with `headspace-cut:`, started by headspace (trigger `plugin`) or typed by you after `/compact` (trigger `manual`). That second way is the fallback when the pane is not at hand:

```
/compact headspace-cut:{"marks":[{"id":"toolu_01AbC","label":"Read src/data.json (9.8k tokens)"}]}
```

`id` is the tool call's `tool_use_id`; `label` is what the stub line names.

Every other compaction, including an automatic one, passes on untouched to Claude Code's own summary.

When it cannot answer (the instructions do not parse past the prefix, or a marked result is no longer in the conversation), it skips the compaction and says why: the conversation stays as it is. It never falls back to a summary nobody asked for.

There is no undo: a removed result is gone from what Claude reads. Your prompts and Claude's answers are never touched; only tool results are.
