/**
 * witness's session state: what it saw Claude do, from which it draws the
 * pane. Nothing here is persisted or sent anywhere.
 */

export type WitnessPhase = 'explore' | 'implement' | 'debug' | 'verify' | 'waiting'

/** A stretch of the session spent in one phase, in session-clock ms. */
export type WitnessSegment = { phase: WitnessPhase; start: number; end: number }

export type WitnessStepStatus = 'pending' | 'in_progress' | 'completed'

/** One of Claude's tasks. `id` is null when the engine's answer carried none. */
export type WitnessStep = {
  id: string | null
  subject: string
  status: WitnessStepStatus
  createdAt: number
  startedAt: number | null
  completedAt: number | null
}

/** An edit that went through, and the step in progress when it was made. */
export type WitnessEdit = { file: string; at: number; stepId: string | null }

/** A finished shell command and whether it succeeded. */
export type WitnessRun = { command: string; at: number; isOk: boolean }

/** A `/goal` criterion: proven by `command` when it has one, ticked by hand when not. */
export type WitnessCriterion = { text: string; command: string | null; isTicked: boolean }

/** The action in progress. */
export type WitnessNow = { label: string; since: number }

declare module 'claude-code' {
  interface PluginState {
    witness: {
      goal: string
      promptGoal: string
      isGoalSet: boolean
      criteria: WitnessCriterion[]
      steps: WitnessStep[]
      edits: WitnessEdit[]
      runs: WitnessRun[]
      segments: WitnessSegment[]
      cursor: number | null
      waitingSince: number | null
      isDebugging: boolean
      now: WitnessNow | null
      beat: boolean
      hasOpened: boolean
      isPlaced: boolean
      isPaused: boolean
      lostAt: string | null
    }
  }
}
