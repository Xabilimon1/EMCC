<h1 align="center">EMCC</h1>

<p align="center">
  <b>Every Mod Claude Code</b><br>
  Claude Code mods that check the work was done, instead of taking Claude's word for it.
</p>

<p align="center">
  <a href="https://github.com/Xabilimon1/EMCC/actions/workflows/ci.yml"><img src="https://github.com/Xabilimon1/EMCC/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2b2b2b?style=flat-square" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/Claude_Code-2.1.287%2B-2b2b2b?style=flat-square" alt="Claude Code 2.1.287 or later">
</p>

<p align="center">
  <a href="#install">Install</a>&emsp;&emsp;
  <a href="#mods">Mods</a>&emsp;&emsp;
  <a href="#what-a-mod-can-reach">What a mod can reach</a>&emsp;&emsp;
  <a href="#quality-bar">Quality bar</a>&emsp;&emsp;
  <a href="#build-on-emcc">Build on EMCC</a>
</p>

<!-- Demo slot: a recording of an EMCC mod at work goes here. -->

"The tests pass" is a sentence. EMCC shows you what is behind it: which checks actually ran in this session, what they returned, and gates that hold when Claude tries to get to green by lowering the bar instead of fixing the code.

## Why EMCC

Skills tell Claude what discipline to follow. Nothing in a skill checks that Claude followed it. A [mod](https://code.claude.com/docs/en/plugins/mods/overview) runs inside Claude Code itself, so it can:

- **Record what ran.** Every test, build, lint and typecheck command and its exit code, as the engine reported them, not as Claude summed them up.
- **Hold the line.** Gates that ask you, or refuse, when Claude tries to pass by lowering the bar: a deleted assertion, a new `@ts-ignore`, `strict` turned off, `continue-on-error` in CI, `--no-verify`.
- **Show it in one place.** One band above the prompt for every EMCC mod, instead of one line each.

Every mod here has tests, states the Claude Code version it was tested with, and lists what it can reach.

## Install

Inside Claude Code 2.1.287 or later:

```
/plugin marketplace add Xabilimon1/EMCC
/plugin install emcc-core@emcc
/plugin install goalpost-guard@emcc
```

Each mod works on its own; together they share one profile and one band. Run `/emcc` to see the profile and what EMCC has recorded so far, and `/goalposts` for what was held. If Claude Code warns about the prompt cache and leaves the plugin pending, run `/reload-plugins --force` or start a new session.

<details>
<summary><b>From your shell</b></summary>

```sh
claude plugin marketplace add Xabilimon1/EMCC
claude plugin install emcc-core@emcc
claude plugin install goalpost-guard@emcc
```

The mods load the next time you start Claude Code. In a session that is already open, run `/reload-plugins`.

To pick the profile at install time:

```sh
claude plugin install emcc-core@emcc --config profile=strict
```

</details>

## Mods

| Mod | What it does | What it can reach | Version |
|---|---|---|---|
| [`emcc-core`](mods/emcc-core) | The base the others build on. Records test, build, lint and typecheck runs and edits; draws one band above the prompt with the latest result of each and the badges other mods post; sets the profile (`standard`, `strict`, `off`); `/emcc-halt` turns every gate off. | No network, no files, no processes | 0.1.1 |
| [`goalpost-guard`](mods/goalpost-guard) | Holds any edit or command that lowers the bar: removed, skipped or loosened tests, rewritten expected values, tests pointed at a stand-in, new suppressions, relaxed lint and type config, softened CI, lowered coverage, skipped git hooks. Asks you (or denies, or reports); remembers exceptions per file or project; puts what was let through in the commit as a `Goalpost-Change` trailer; `/goalposts audit` checks a branch. | Reads the files a change touches; runs `git` only for `/goalposts audit`; no network | 0.1.3 |

### Coming next

| Order | Mod | What it will do |
|---|---|---|
| 1 | `redgreen` | TDD that only moves on when the test output says so: red first, then green. |
| 2 | `cassette` | Records model replies once and replays a session offline, the same way every time. |

## What a mod can reach

Mods run with the same access to your machine as Claude Code itself. They are not sandboxed: a mod can read files, run commands, and rewrite prompts and tool calls. Read a mod's source before you install it, from EMCC or anywhere else.

Every EMCC mod lists what it hooks and calls in its own README, and `claude plugin validate` prints the same list from the source, so you can check one against the other.

To turn mods off: `/plugin disable <mod>` for one, `claude --safe-mode` for a session, or `"disableAllHooks": true` in your settings.

## Quality bar

Every mod in EMCC:

- passes `claude plugin validate --strict`
- has tests run by `claude plugin test`, each one seen failing before it passed
- draws on both the terminal and the desktop app wherever it draws, tested on both
- states the Claude Code version it was tested with

CI runs the first two on every push.

## Build on EMCC

`emcc-core` adds `$.emcc` to every mod's engine interface: the evidence it recorded, a slot in the shared band, the profile and the kill switch. emcc-core may not be installed, so call it inside a `try`; `goalpost-guard` does exactly this:

```ts
async function emccProfile($: EngineInterface): Promise<EmccProfile | null> {
  try {
    return await $.emcc.profile()
  } catch {
    return null // emcc-core is not installed
  }
}
```

The full API is in [`mods/emcc-core`](mods/emcc-core#for-mod-authors-emcc).

### Developing

```sh
claude plugin validate --strict .          # the marketplace and every mod
claude plugin test mods/<mod>              # one mod's tests
```

For type checking, run `/plugin-types` inside Claude Code at the repo root (it writes `.claude/types`), then `npx -p typescript tsc -p .`.

A mod is a folder under `mods/` with `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.tsx`, its `types/index.d.ts` contract and `tests/`. Add it to `.claude-plugin/marketplace.json`.

## License

[MIT](LICENSE)
