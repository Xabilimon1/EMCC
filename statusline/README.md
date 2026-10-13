# Status line

A single-line status line for Claude Code. It shows how full the context window is, how much of the 5-hour and 7-day rate limits you have used, the model, the project and the directory:

```
ctx:[█████░░░░░] 46% | 5h:[███░░░░░]37% | 7d:[█░░░░░░░]15% | model:Opus 5.5 | proj:EMCC | Developer/EMCC
```

It is one bash script, [`statusline.sh`](statusline.sh). It is not a mod: Claude Code runs it as a [status line command](https://code.claude.com/docs/en/statusline), it reads JSON on stdin and prints one line.

## What each part shows

Everything comes from the JSON Claude Code sends on stdin.

| Part | Shows | Source |
|---|---|---|
| `ctx` | Share of the context window used, as a 10-block bar and a percentage. Counts input tokens only, as Claude Code calculates it. Shows `0%` while the field is still `null` early in a session. | `context_window.used_percentage` |
| `5h` | Share of the 5-hour rate limit used, 8-block bar. | `rate_limits.five_hour.used_percentage` |
| `7d` | Share of the 7-day rate limit used, 8-block bar. | `rate_limits.seven_day.used_percentage` |
| `model` | Model name, without the `Claude ` prefix: `Opus 5.5`, `Sonnet 5.5`, `Haiku 4.5`. | `model.display_name`, or `model.id` if there is no display name |
| `proj` | Name of the git repository root of the current directory; the directory name if it is not in a git repository. `?` if there is no directory. | `workspace.current_dir`, then `git rev-parse --show-toplevel` |
| last part | The last two components of the current directory, with your home directory written as `~`. | `workspace.current_dir` |

Bar and percentage are green below 50, yellow from 50, red from 80. The percentage is rounded first, so 79.6 counts as 80.

`rate_limits` only appears for Claude.ai Pro and Max subscribers (or behind a Claude apps gateway), and only after the first API response of a session. Until then, and for API-key users, `5h` and `7d` show an empty grey bar and `--`.

## Requirements

- bash
- [jq](https://jqlang.github.io/jq/), to read the JSON
- git, for the project name (without it the directory name is used)
- awk and sed, which macOS and Linux have

Tested on macOS. It uses nothing macOS-specific, but it has not been run on Linux.

Without jq the script does not fail: it prints a line with `ctx` at 0%, `--` for both limits and an empty model name, and jq's "command not found" goes to stderr. Install jq (`brew install jq`).

## Install

Copy the script and make it executable:

```sh
cp statusline/statusline.sh ~/.claude/statusline.sh
chmod +x ~/.claude/statusline.sh
```

Add it to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash ~/.claude/statusline.sh"
  }
}
```

The `~` works because Claude Code runs `command` through a shell, and the Claude Code documentation uses `~/.claude/statusline.sh` in its own examples. Starting the command with `bash` means it also works if the file is not executable. Restart Claude Code to pick it up.

To test the script without Claude Code, pipe it some JSON:

```sh
printf '%s' '{"model":{"display_name":"Opus 5.5"},"context_window":{"used_percentage":46},"workspace":{"current_dir":"'"$PWD"'"}}' | bash ~/.claude/statusline.sh
```

## Change it

Line numbers refer to `statusline.sh`.

- **Color thresholds**: `pct_color`, lines 24 and 25. `-ge 80` is red, `-ge 50` is yellow, anything lower is green.
- **Bar width**: the second argument of `colored_bar` on line 54 (`ctx`, 10) and on lines 60 and 69 (`5h` and `7d`, 8).
- **Bar characters**: the `█` and `░` in `colored_bar`, lines 39 and 40.
- **Colors**: the ANSI codes at the top, lines 8 to 16.
- **Separator**: `SEP` in the assemble section, line 115.
- **Remove a part**: delete its `parts+=(...)` line in the assemble section (lines 117 to 122). For example, delete line 119 to drop the 7-day bar. The code above that builds it can stay.
- **Reorder**: move the `parts+=(...)` lines.
