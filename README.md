# EMCC — Every Mod Claude Code

A curated, tested collection of [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview).

Skills tell Claude what discipline to follow. EMCC's mods check that it did, inside Claude Code and on screen: evidence of what actually ran, gates that hold, and one status band instead of ten.

> **Status: early.** One mod so far (`emcc-core`), the base the rest of the catalog builds on. Tested with **Claude Code 2.1.287**. The mods API changes between releases, so every mod states the version it was tested with.

## Install

```sh
claude plugin marketplace add Xabilimon1/EMCC
claude plugin install emcc-core@emcc
```

Or from inside Claude Code: `/plugin marketplace add Xabilimon1/EMCC`, then `/plugin install emcc-core@emcc`.

## Mods

| Mod | What it does | Status |
|---|---|---|
| [`emcc-core`](mods/emcc-core) | The `$.emcc` noun other mods build on: evidence of test, build, lint and typecheck runs and of edits; badges in one band above the prompt; a profile (`standard`, `strict`, `off`); a kill switch (`/emcc-halt`). | 0.1.0 |

Coming next, in order: `goalpost-guard` (stops "passing" by lowering the bar: weakened tests, suppressions, relaxed config, CI thresholds), `redgreen` (TDD that only advances on real test output), and `cassette` (record model replies once, replay sessions offline and deterministically).

## Read this before installing any mod

Mods run with the same access to your machine as Claude Code itself. They are not sandboxed: a mod can read files, run commands, rewrite prompts and tool calls. Read a mod's source before you install it, from EMCC or anywhere else. Every EMCC mod lists what it hooks and calls in its README, and `claude plugin validate` prints the same list from the source.

Turn mods off any time with `/plugin disable <mod>`, `claude --safe-mode`, or `"disableAllHooks": true`.

## Quality bar

Every mod in EMCC:

- passes `claude plugin validate --strict`
- has tests run by `claude plugin test`, each one seen failing before it passed
- draws on both the terminal and the desktop app where it draws at all, tested on both
- says which Claude Code version it was tested with

CI runs the first two on every push.

## Developing

```sh
claude plugin validate --strict .          # the marketplace and every mod
claude plugin test mods/<mod>              # one mod's tests
```

For type checking, run `/plugin-types` inside Claude Code at the repo root (it writes `.claude/types`), then `npx -p typescript tsc -p .`.

A mod is a folder under `mods/` with `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.tsx`, its `types/index.d.ts` contract and `tests/`. Add it to `.claude-plugin/marketplace.json`.

## License

[MIT](LICENSE)
