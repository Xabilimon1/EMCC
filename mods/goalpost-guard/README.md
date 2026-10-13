# goalpost-guard

Stops Claude from making a check pass by lowering the bar. Tested with **Claude Code 2.1.287**, terminal and desktop.

When a test fails, the shortest way to green is often not to fix the code but to move the goalposts: delete the assertion, skip the test, add `@ts-ignore`, turn `strict` off, put `continue-on-error` on the CI step, drop the coverage threshold, or commit with `--no-verify`. goalpost-guard reads every edit and shell command before it runs, and when one does that, it stops and asks you.

<p align="center">
  <img src="../../docs/media/goalpost-guard/demo.gif" width="880" alt="Claude Code with Haiku 4.5, told src/ is frozen, rewrites a test's expected value; goalpost-guard holds the edit; the answer goes back to Claude, which fixes src/cart.js instead">
</p>
<p align="center"><sub>A real session with Haiku 4.5: told <code>src/</code> is frozen, it tries to change what the test expects. <a href="../../docs/media/goalpost-guard/demo.mp4">MP4</a></sub></p>

<img src="../../docs/media/goalpost-guard/dialog.png" alt="Goalpost Guard: this change test/cart.test.js changes the values in 1 assertion. Allow it? Block it, Allow once, Allow in this file, Allow in this project, Type something">

Anything you type instead goes to Claude, word for word, as the reason the change was blocked:

<img src="../../docs/media/goalpost-guard/answer.png" alt="The fifth option filled in: Not like that. src isn't really frozen: fix the rounding in withTax and run npm test.">

## Install

```
/plugin marketplace add Xabilimon1/emcc-claude-code-mods
/plugin install goalpost-guard@emcc
```

Works on its own. With [`emcc-core`](../emcc-core) installed it follows the EMCC profile and posts its count to the EMCC band.

## What it catches

| Family | Caught when a change… |
|---|---|
| **Tests** | removes or comments out assertions; rewrites the value an assertion expects (`24.19` to `24`); points the test at a stand-in module while the real one is still there (`../src/cart.js` to `../lib/cart.js`; an import that follows a moved file is fine); swaps an imported function for a copy written inside the test; removes test cases or deletes a test file (also with `rm` or `git rm`); adds `.skip`, `xit`, `@pytest.mark.skip`, `xfail`, `t.Skip()`, `#[ignore]`, `@Disabled`; adds `.only`; trades exact checks for loose ones (`toBe(3)` for `toBeDefined()`); rewrites a snapshot by hand or runs the tests with `-u`; runs them with `--testPathIgnorePatterns`, `-k "not …"`, `--deselect`, `--passWithNoTests` |
| **Suppressions** | adds `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable`, `biome-ignore`, `# noqa`, `# type: ignore`, `pyright: ignore`, `pylint: disable`, `//nolint`, `#[allow(…)]`, `@SuppressWarnings`, `rubocop:disable`, `NOLINT`, `istanbul`/`c8 ignore`, `pragma: no cover` and more |
| **Config** | turns off a strict flag in a `tsconfig` (one `strict` still covers is fine); lowers or removes an ESLint, Biome or Stylelint rule; turns mypy's `strict` off or `ignore_errors` on; grows a ruff, flake8 or pylint ignore list |
| **CI** | adds `continue-on-error: true`, `allow_failure: true`, `\|\| true`, `if: false` or `set +e`; removes a step that runs tests, lint, types or a build; removes a pre-commit hook. GitHub Actions, GitLab, CircleCI, Azure, Bitbucket, Buildkite, Jenkins, Travis, pre-commit, lefthook, husky |
| **Coverage** | lowers or removes a threshold: jest `coverageThreshold`, vitest `thresholds`, coverage.py `fail_under`, `--cov-fail-under`, codecov `target`, nyc and c8, SimpleCov, JaCoCo |
| **Git hooks** | `git commit` or `push --no-verify`, `git commit -n`, `HUSKY=0`, `SKIP=…`, `LEFTHOOK=0`, `git config core.hooksPath` |

It also holds `sed -i`, `perl -pi` and `>` redirects into a test, config or CI file: it cannot see that diff, so it asks Claude to use Edit instead.

Adding tests, assertions, checks and thresholds is never a finding, and neither is writing about `@ts-ignore` in a Markdown file.

## What happens next

| Mode | What it does |
|---|---|
| `inherit` (default) | Follows the EMCC profile: `standard` lets it through and reports it, `strict` denies, `off` is off; both post a flag that witness shows on the step. Without emcc-core, asks |
| `ask` | The dialog above |
| `deny` | Refuses the change and tells Claude to fix the code instead |
| `warn` | Lets it through, records it, and tells Claude to report it in its summary |
| `off` | Nothing |

In `claude -p` and other runs with no screen, nobody can answer the dialog, so `ask` refuses (set `headless` to `allow` to let it through and report it instead). If goalpost-guard cannot read the file it is checking, it holds the change rather than let it through.

**Exceptions** last across sessions and are scoped to the project: "Allow in this file" covers that rule in that file, "Allow in this project" covers that rule everywhere in the project. Revoke them in the ledger.

## The ledger: `/goalposts`

`/goalposts` opens a pane with three tabs (keys `1`, `2`, `3`; `p` pauses, Esc closes):

<table>
  <tr>
    <td width="34%" valign="top"><img src="../../docs/media/goalpost-guard/ledger.png" alt="Ledger tab: an allowed change with the old and new assertion, and a held one with a button to allow it in the file"></td>
    <td width="33%" valign="top"><img src="../../docs/media/goalpost-guard/exceptions.png" alt="Exceptions tab: one standing exception with a Revoke button"></td>
    <td width="33%" valign="top"><img src="../../docs/media/goalpost-guard/rules.png" alt="Rules tab: six families, each on, with a Mute button"></td>
  </tr>
</table>

- **Ledger**: every decision this session, newest first: held, allowed, standing exception or noted, the file, what the change did, and the lines it removed (`-`) or added (`+`). A held change has an **Allow in this file** button.
- **Exceptions**: the standing ones for this project, each with **Revoke**.
- **Rules**: each family on or off. **Mute** turns one off for this session; `/config` turns it off for good (a family off there shows `/config` instead of the button).

**Pause** turns goalpost-guard off for the session, like `/goalposts pause` (`/goalposts resume` brings it back). Without emcc-core, a line above the prompt counts what was held and let through, with a **Ledger** button.

## Commit trailers

Whatever was let through ends up in the next commit Claude makes, as a git trailer, so a reviewer sees it in `git log`:

<img src="../../docs/media/goalpost-guard/commit.png" alt="git log -1: Round tax to whole euros, Goalpost-Change: test/cart.test.js: changes the values in 1 assertion (allowed by the user: from now on in this file)">

Each change is reported once; a `git commit --amend` of that commit carries its trailers again, since an amend rewrites the message. A commit that fails keeps them for the next. Needs git 2.32 or later; turn it off with `commitTrailer`.

## Audit what is already there: `/goalposts audit [ref]`

Checks every change since `ref` (default `HEAD`), untracked files included, with the same rules:

<img src="../../docs/media/goalpost-guard/audit.png" alt="/goalposts audit main: 3 changes lower the bar since main: continue-on-error in ci.yml, an eslint-disable in src/legacy.js, a skipped test in test/cart.test.js">

## Options

Set them in `/config`, or at install with `--config key=value`.

| Option | Default | What it does |
|---|---|---|
| `mode` | `inherit` | `inherit`, `ask`, `deny`, `warn` or `off`, as above |
| `tests`, `suppressions`, `config`, `ci`, `coverage`, `bypass` | on | Each family of checks |
| `headless` | `deny` | With no one to ask: `deny`, or `allow` and report |
| `commitTrailer` | on | The `Goalpost-Change` trailers |
| `testPattern` | none | A regular expression for test files with unusual names, on top of `*.test.ts`, `test_*.py`, `*_test.go`, `*Test.java`, `*_spec.rb`, `tests/`… |
| `ignorePaths` | none | Globs to leave alone, such as `vendor/**` |

## What it hooks and calls

- Hooks: `session.start`, `command.run` (`goalposts`), `tool.call` (`Edit`, `Write`, `Bash`, before they run), `ui.render` (`AbovePrompt`, the `goalposts` pane)
- Calls: `$.fs.read` and `$.fs.exists` (the file a change touches), `$.process.run` (`git diff`, `git show` and `git ls-files`, only for `/goalposts audit`), `$.ui.ask`, `$.ui.open`, `$.ui.close`, `$.store` (exceptions), `$.state`, `$.session.cwd`, `$.session.surfaces`, `$.clock.now`, `$.command.register`, `$.emcc.profile` and `$.emcc.badge` (when emcc-core is installed)
- It rewrites one thing: it adds `--trailer` flags to a `git commit` command. It never changes an edit.
- No network.

## Limits

- It reads the change, not your intent: the checks are patterns, tuned to keep false alarms rare. A rename that drops one `expect` and adds another is fine; one that drops two and adds one is asked about.
- `NotebookEdit` is not checked yet.
- A file changed by a program it cannot read (a Python one-liner, a code generator) is not seen until `/goalposts audit`.

## Tests

```sh
claude plugin test mods/goalpost-guard
```

79 tests: the detectors (37), the gate, modes, options, exceptions, retargeted imports, trailers and audit (30), and the band and the pane on both terminal and desktop, plus the EMCC profile, badge and flags (12). Each one was seen failing before it passed, by breaking the code it checks.
