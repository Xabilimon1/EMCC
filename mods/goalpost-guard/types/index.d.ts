/**
 * goalpost-guard's contract: what it finds, what it decided, and the values it
 * keeps in `$.state` for its band slot and its pane.
 */

/**
 * The families of change a person can turn on or off, one `userConfig`
 * switch each.
 */
export type GoalpostCategory = 'tests' | 'suppressions' | 'config' | 'ci' | 'coverage' | 'bypass'

/**
 * Each way of lowering the bar the detectors know.
 */
export type GoalpostRule =
  | 'tests.assertions'
  | 'tests.removed'
  | 'tests.skipped'
  | 'tests.focused'
  | 'tests.loosened'
  | 'tests.expected'
  | 'tests.snapshots'
  | 'tests.narrowed'
  | 'suppressions'
  | 'config'
  | 'ci'
  | 'coverage'
  | 'bypass'
  | 'shell-edit'

/**
 * One thing a change does to lower the bar. `before` and `after` hold a few
 * sample lines (removed and added) for the pane; `category` is set only when
 * it differs from the rule's own (a shell edit takes its file's).
 */
export type GoalpostFinding = {
  rule: GoalpostRule
  title: string
  detail: string
  file?: string
  before?: string[]
  after?: string[]
  category?: GoalpostCategory
}

/**
 * What happened to a finding: held and refused, let through by the person
 * (once, or from now on for that file), let through by an exception made
 * earlier, or only reported (`warn` mode).
 */
export type GoalpostDecision = 'blocked' | 'allowed' | 'excepted' | 'warned'

/**
 * One finding and its decision, as the pane lists it and a commit trailer
 * reports it.
 */
export type GoalpostEntry = {
  id: string
  at: number
  tool: string
  finding: GoalpostFinding
  decision: GoalpostDecision
  /** Why the person allowed it, or what they told Claude to do instead. */
  note?: string
  /** Set once a `git commit` carried it in a trailer. */
  isReported?: boolean
}

/**
 * A standing permission: this rule, in this file (or anywhere in the project
 * when `file` is absent), for this project. Kept in `$.store`, across sessions.
 */
export type GoalpostException = {
  project: string
  rule: GoalpostRule
  file?: string
  note: string
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'goalpost-guard': {
      ledger: GoalpostEntry[]
      exceptions: GoalpostException[]
      tab: 'ledger' | 'exceptions' | 'rules'
      muted: GoalpostCategory[]
      isPaused: boolean
    }
  }
}
