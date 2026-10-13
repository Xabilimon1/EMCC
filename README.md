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
  <a href="#see-it-work">See it work</a>&emsp;&emsp;
  <a href="#install">Install</a>&emsp;&emsp;
  <a href="#mods">Mods</a>&emsp;&emsp;
  <a href="#what-a-mod-can-reach">What a mod can reach</a>&emsp;&emsp;
  <a href="#build-on-emcc">Build on EMCC</a>
</p>

<p align="center">
  <img src="docs/media/goalpost-guard/demo.gif" width="880" alt="Claude Code with Haiku 4.5, told src/ is frozen, rewrites a test's expected value from 24.19 to 24; goalpost-guard holds the edit and asks; the answer goes back to Claude, which fixes the rounding in src/cart.js instead, and the tests pass">
</p>
<p align="center"><sub>A real session, not a mock-up: Claude Code 2.1.287 with Haiku 4.5, told <code>src/</code> is frozen, tries to make a failing test pass by changing what it expects. <a href="docs/media/goalpost-guard/demo.mp4">MP4</a></sub></p>

"The tests pass" is a sentence. EMCC shows you what is behind it: which checks actually ran in this session, what they returned, and gates that hold when Claude tries to get to green by lowering the bar instead of fixing the code.

## Why EMCC

Skills tell Claude what discipline to follow. Nothing in a skill checks that Claude followed it. A [mod](https://code.claude.com/docs/en/plugins/mods/overview) runs inside Claude Code itself, so it can:

- **Record what ran.** Every test, build, lint and typecheck command and its exit code, as the engine reported them, not as Claude summed them up.
- **Hold the line.** Gates that ask you, or refuse, when Claude tries to pass by lowering the bar: a deleted assertion, a new `@ts-ignore`, `strict` turned off, `continue-on-error` in CI, `--no-verify`.
- **Show it in one place.** One band above the prompt for every EMCC mod, instead of one line each.

Every mod here has tests, states the Claude Code version it was tested with, and lists what it can reach.

## See it work

Every image below is a real Claude Code session, recorded from a script you can rerun ([how](docs/media/README.md)).

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/media/goalpost-guard/dialog-card.png" alt="The goalpost-guard question: this change test/cart.test.js changes the values in 1 assertion. Allow it? Block it, Allow once, Allow in this file, Allow in this project, or type something">
      <p><img src="docs/icons/goalpost.svg" width="20" height="20" align="top" alt=""> <b>It asks before the bar moves.</b><br>Block it, allow it once, for the file or for the project, or tell Claude what to do instead.</p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/media/goalpost-guard/fixed-card.png" alt="The held edit shows Error editing file; Claude then fixes withTax in src/cart.js and the EMCC band reads test pass, goalposts: 1 held">
      <p><img src="docs/icons/band.svg" width="20" height="20" align="top" alt=""> <b>Then Claude fixes the code.</b><br>The EMCC band shows the test run that passed and what was held on the way.</p>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <img src="docs/media/goalpost-guard/ledger.png" alt="The Goalpost Guard ledger pane: an allowed change with the old and new assertion, and a held one with the assertion it removed">
      <p><img src="docs/icons/ledger.svg" width="20" height="20" align="top" alt=""> <b>Every decision, with its lines.</b><br><code>/goalposts</code> opens the ledger: what was held or let through, and what it removed or added.</p>
    </td>
    <td valign="top">
      <img src="docs/media/goalpost-guard/rules.png" alt="The Rules tab: tests, suppressions, config, CI, coverage thresholds and skipped git hooks, each on, with a Mute button">
      <p><img src="docs/icons/rules.svg" width="20" height="20" align="top" alt=""> <b>Six families, each switchable.</b><br>Mute one for the session; <code>/config</code> for good.</p>
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <img src="docs/media/goalpost-guard/commit.png" alt="git log showing the commit Round tax to whole euros with the trailer Goalpost-Change: test/cart.test.js: changes the values in 1 assertion (allowed by the user: from now on in this file)">
      <p><img src="docs/icons/commit.svg" width="20" height="20" align="top" alt=""> <b>What was let through goes in the commit.</b> A <code>Goalpost-Change</code> trailer, so the reviewer sees it in <code>git log</code>.</p>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <img src="docs/media/goalpost-guard/audit.png" alt="/goalposts audit main listing three changes that lower the bar: continue-on-error in ci.yml, an eslint-disable, and a skipped test">
      <p><img src="docs/icons/audit.svg" width="20" height="20" align="top" alt=""> <b>Audit a branch.</b><br><code>/goalposts audit main</code> finds what already lowered the bar.</p>
    </td>
    <td valign="top">
      <img src="docs/media/goalpost-guard/exceptions.png" alt="The Exceptions tab with one standing exception and a Revoke button">
      <p><img src="docs/icons/exceptions.svg" width="20" height="20" align="top" alt=""> <b>Exceptions you can take back.</b><br>They last across sessions, scoped to a file or a project.</p>
    </td>
  </tr>
</table>

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

| | Mod | What it does | What it can reach | Version |
|---|---|---|---|---|
| <img src="docs/icons/band.svg" width="20" height="20" align="top" alt=""> | [`emcc-core`](mods/emcc-core) | The base the others build on. Records test, build, lint and typecheck runs and edits; draws one band above the prompt with the latest result of each and the badges other mods post; sets the profile (`standard`, `strict`, `off`); `/emcc-halt` turns every gate off. | No network, no files, no processes | 0.1.1 |
| <img src="docs/icons/goalpost.svg" width="20" height="20" align="top" alt=""> | [`goalpost-guard`](mods/goalpost-guard) | Holds any edit or command that lowers the bar: removed, skipped or loosened tests, rewritten expected values, tests pointed at a stand-in, new suppressions, relaxed lint and type config, softened CI, lowered coverage, skipped git hooks. Asks you (or denies, or reports); remembers exceptions per file or project; puts what was let through in the commit as a `Goalpost-Change` trailer; `/goalposts audit` checks a branch. | Reads the files a change touches; runs `git` only for `/goalposts audit`; no network | 0.1.6 |

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
