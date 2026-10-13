/**
 * The `$.emcc` noun as every caller sees it: EMCC's shared base for mods.
 *
 * emcc-core adds the noun in its `engine.create` step. Another mod calls it
 * (`await $.emcc.profile()`) after checking that it exists, since emcc-core
 * may not be installed. Nothing here is imported, so it stands on its own.
 */

/**
 * What a piece of evidence is about: a command of one of four kinds whose
 * outcome is known, or a file the session edited.
 */
export type EmccEvidenceKind = 'test' | 'build' | 'lint' | 'typecheck' | 'edit'

/**
 * The kinds a shell command can run: every evidence kind but `edit`.
 */
export type EmccCommandKind = Exclude<EmccEvidenceKind, 'edit'>

/**
 * One observed fact. Commands carry their outcome; edits carry the file.
 * `at` is the session clock in milliseconds, as `$.clock.now()` reads it.
 */
export type EmccEvidence = {
  kind: EmccEvidenceKind
  at: number
  command?: string
  exitCode?: number
  isOk?: boolean
  file?: string
}

/**
 * How strict the EMCC gates are. `off` also stands while the session is
 * halted, so a mod that reads `profile()` alone respects the kill switch.
 */
export type EmccProfile = 'standard' | 'strict' | 'off'

/**
 * A mod's slot in the one EMCC band above the prompt.
 */
export type EmccTone = 'neutral' | 'good' | 'warn' | 'bad'

export type EmccBadge = { id: string; text: string; tone: EmccTone }

/**
 * A lowered bar a mod noticed: what rule, where, and one line for people.
 * `at` is the session clock in milliseconds, set by emcc-core.
 */
export type EmccFlag = {
  source: string
  rule: string
  file?: string
  text: string
  at: number
}

export type Emcc = {
  /**
   * The newest evidence of a kind, or null when there is none yet.
   * @example
   * const test = await $.emcc.evidenceLatest({ kind: 'test' })
   */
  evidenceLatest: (input: { kind: EmccEvidenceKind }) => Promise<EmccEvidence | null>

  /**
   * Every evidence recorded at or after `at`, oldest first.
   * @example
   * const since = await $.emcc.evidenceSince({ at: turnStartedAt })
   */
  evidenceSince: (input: { at: number }) => Promise<EmccEvidence[]>

  /**
   * Shows, replaces or (without `text`) removes a mod's slot in the band.
   * Call it from a hook or a handler, never while drawing.
   * @example
   * await $.emcc.badge({ id: 'redgreen', text: 'RED', tone: 'bad' })
   */
  badge: (input: { id: string; text?: string; tone?: EmccTone }) => Promise<void>

  /**
   * The active profile: the configured one, or `off` while halted.
   */
  profile: () => Promise<EmccProfile>

  /**
   * Whether the kill switch is on (`/emcc-halt` or the band's Halt button).
   */
  isHalted: () => Promise<boolean>

  /**
   * Records a lowered bar for other mods to show. Call it from a hook or a
   * handler, never while drawing.
   * @example
   * await $.emcc.flag({ source: 'goalpost-guard', rule: 'tests.expected', file, text: 'changes the values in 1 assertion' })
   */
  flag: (input: { source: string; rule: string; file?: string; text: string }) => Promise<void>

  /**
   * Every flag raised at or after `at`, in the order they were recorded.
   */
  flagsSince: (input: { at: number }) => Promise<EmccFlag[]>

  /**
   * The evidence kinds a shell command runs, as the log classifies it:
   * `npm run build && npm test` is `['test', 'build']`, `git status` is `[]`.
   */
  kindsOf: (input: { command: string }) => Promise<EmccCommandKind[]>
}

declare module 'claude-code' {
  interface EngineInterface {
    emcc: Emcc
  }

  interface PluginState {
    'emcc-core': {
      evidence: EmccEvidence[]
      badges: EmccBadge[]
      flags: EmccFlag[]
      isHalted: boolean
    }
  }
}
