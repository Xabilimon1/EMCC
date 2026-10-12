# goalpost-guard

Stops Claude from making a check pass by lowering the bar. Tested with **Claude Code 2.1.287**, terminal and desktop.

When a test fails, the shortest way to green is often not to fix the code but to move the goalposts: delete the assertion, skip the test, add `@ts-ignore`, turn `strict` off, put `continue-on-error` on the CI step, drop the coverage threshold, or commit with `--no-verify`. goalpost-guard reads every edit and shell command before it runs, and when one does that, it stops and asks you.

> **Goalpost Guard: this change src/add.test.js removes 1 assertion. Allow it?**  
> Block it, Allow once, Allow in this file, Allow in this project, or type something

Anything you type instead goes to Claude, word for word, as the reason the change was blocked ("fix the rounding in add() instead").

## Install

```
/plugin marketplace add Xabilimon1/EMCC
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
| `inherit` (default) | Follows the EMCC profile: `standard` asks, `strict` denies, `off` is off. Without emcc-core, asks |
| `ask` | The dialog above |
| `deny` | Refuses the change and tells Claude to fix the code instead |
| `warn` | Lets it through, records it, and tells Claude to report it in its summary |
| `off` | Nothing |

In `claude -p` and other runs with no screen, nobody can answer the dialog, so `ask` refuses (set `headless` to `allow` to let it through and report it instead). If goalpost-guard cannot read the file it is checking, it holds the change rather than let it through.

**Exceptions** last across sessions and are scoped to the project: "Allow in this file" covers that rule in that file, "Allow in this project" covers that rule everywhere in the project. Revoke them in the ledger.

## The ledger: `/goalposts`

`/goalposts` opens a pane with three tabs:

- **Ledger**: every decision this session, newest first: held, allowed, standing exception or noted, the file, what the change did, and the lines it removed (`-`) or added (`+`). A held change has an **Allow in this file** button.
- **Exceptions**: the standing ones for this project, each with **Revoke**.
- **Rules**: each family on or off. **Mute** turns one off for this session; `/config` turns it off for good.

**Pause** turns goalpost-guard off for the session, like `/goalposts pause` (`/goalposts resume` brings it back). Without emcc-core, a line above the prompt counts what was held and let through, with a **Ledger** button.

## Commit trailers

Whatever was let through ends up in the next commit Claude makes, as a git trailer, so a reviewer sees it in `git log`:

```
drop zero case

Goalpost-Change: src/add.test.js: removes 1 assertion (allowed by the user)
```

Each change is reported once. A commit that fails keeps them for the next. Needs git 2.32 or later; turn it off with `commitTrailer`.

## Audit what is already there: `/goalposts audit [ref]`

Checks every change since `ref` (default `HEAD`), untracked files included, with the same rules:

```
/goalposts audit main

2 changes lower the bar since main:
- src/add.test.js removes 1 assertion: 2 → 1 assertions
- src/c.ts adds @ts-ignore: the check still runs, it just stops reporting here
```

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

75 tests: the detectors (36), the gate, modes, options, exceptions, retargeted imports, trailers and audit (29), and the band and the pane on both terminal and desktop, plus the EMCC profile and badge (10). Each one was seen failing before it passed, by breaking the code it checks.
