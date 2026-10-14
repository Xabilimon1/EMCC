/**
 * headspace's session state: the bar's last reading, the rule changes
 * (pending and in force), the session rules, the marked large results and
 * what the pane shows. Save backups live in `$.store`, not here.
 */

export type HeadspaceKind = 'system' | 'rules' | 'conversation' | 'large' | 'free' | 'reserve'

/** One segment of the bar: its kind and tokens. */
export type HeadspaceSegment = { kind: HeadspaceKind; tokens: number }

/** The bar's last reading. `window` is the breakdown's rawMaxTokens; `percent` its percentage. */
export type HeadspaceSnapshot = { segments: HeadspaceSegment[]; window: number; percent: number; at: number }

/** A change to one rule, keyed by its RuleId (see rules.ts). */
export type HeadspaceRuleChange =
  | { type: 'off' }
  | { type: 'edit'; lineIndex: number; text: string }
  | { type: 'addLine'; afterLineIndex: number; text: string }

/** A file's changes; `source` is the path, or 'memory' for auto-memory entries. */
export type HeadspaceFileChanges = { source: string; changes: Record<string, HeadspaceRuleChange[]> }

/** A large result the person marked: what headspace-cut needs to stub it. */
export type HeadspaceMark = { id: string; label: string }

/**
 * What the saves of one file wrote this session: the rule ids whose changes
 * went into it, the session rules added to it, and a hash (rules.ts `hash`)
 * of the text the engine held for it when the save went through. While the
 * engine hands that text, those changes and rules stay in force over it.
 */
export type HeadspaceSaved = { ids: string[]; rules: string[]; loaded: string }

declare module 'claude-code' {
  interface PluginState {
    headspace: {
      snapshot: HeadspaceSnapshot | null
      /** Changes waiting for Apply. */
      pending: HeadspaceFileChanges[]
      /** Changes in force: what prompt.context and prompt.section apply. */
      applied: HeadspaceFileChanges[]
      sessionRules: string[]
      /** Session rules waiting for Apply (added or removed since the last Apply). */
      pendingSessionRules: string[] | null
      marks: HeadspaceMark[]
      /** Changes dropped because their file changed on disk. */
      staleCount: number
      /** The kind the pane shows. */
      selected: HeadspaceKind
      /** The rule or large result selected in the pane, by id. */
      cursor: string | null
      /** Set while a cut compaction is in flight. */
      isCutting: boolean
      /** The last event a hook failed at, shown in the pane. */
      lostAt: string | null
      /** Per path saved this session: what its saves wrote, until the engine reads the saved file. */
      savedFrom: Record<string, HeadspaceSaved>
    }
  }
}
