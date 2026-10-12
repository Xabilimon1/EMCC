# emcc-core

The base EMCC mods build on. Tested with **Claude Code 2.1.287**, terminal and desktop.

## What you get

- **One band above the prompt** with the latest result of each kind of check (`test pass`, `lint FAIL 1`), the badges other EMCC mods post, and a **Halt** button. It stays hidden until there is something to show.
- **`/emcc`** prints the profile, the evidence and the badges.
- **`/emcc-halt`** turns every EMCC gate off for the session, or back on. The band's Halt button does the same.
- **Profile** (`/config`, or `claude plugin install emcc-core@emcc --config profile=strict`): `standard` (gates ask), `strict` (gates deny) or `off`.

## For mod authors: `$.emcc`

emcc-core may not be installed, and `claude plugin validate` refuses a mod that reads `$.emcc` as a value (`if ($.emcc)`), so call a method and catch: with emcc-core missing, the call throws.

```ts
async function emccProfile($: EngineInterface): Promise<EmccProfile | null> {
  try {
    return await $.emcc.profile()
  } catch {
    return null // emcc-core is not installed
  }
}

// in a hook
const profile = await emccProfile($)
if (profile === 'strict') {
  const test = await $.emcc.evidenceLatest({ kind: 'test' })
  if (!test?.isOk) {
    return { deny: 'Run the tests first.' }
  }
}
```

| Method | Answers |
|---|---|
| `evidenceLatest({ kind })` | The newest evidence of `test`, `build`, `lint`, `typecheck` or `edit`, or `null` |
| `evidenceSince({ at })` | All evidence at or after `at` (ms, as `$.clock.now()` reads) |
| `badge({ id, text?, tone? })` | Shows or replaces your slot in the band; without `text` removes it. Not while drawing |
| `profile()` | `standard`, `strict` or `off` (`off` also while halted) |
| `isHalted()` | Whether the kill switch is on |

The types are in [`types/index.d.ts`](types/index.d.ts); `/plugin-types` copies them for a mod that depends on emcc-core.

**How evidence is read.** A finished Bash command is classified by its text (`npm test`, `pytest`, `tsc`, `eslint`, `cargo build`…, see [`hooks/evidence.ts`](hooks/evidence.ts)). Its outcome comes from what the engine reported: no error is exit 0, an error is the `Exit code N` the model read. Commands sent to the background are not recorded, since their outcome is not known yet. Edits come from `Edit`, `Write` and `NotebookEdit`. The newest 200 are kept for the session.

## What it hooks and calls

- Hooks: `engine.create` (adds `$.emcc`), `session.start`, `command.run` (`emcc`, `emcc-halt`), `tool.call` (`Bash`, `Edit`, `Write`, `NotebookEdit`, after they run, never changing them), `ui.render` (`AbovePrompt`)
- Calls: `$.clock.now`, `$.command.register`, `$.state.get`, `$.state.set`, `$.ui.resolve`
- No network, no file access, no processes.

## Tests

```sh
claude plugin test mods/emcc-core
```

12 tests: the classifier, the evidence bus, profile and kill switch, badges, and the band on both terminal and desktop.
