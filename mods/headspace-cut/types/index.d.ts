/**
 * headspace-cut's session state: whether it loaded, and when it last saw a
 * turn end, so headspace offers to remove results only while this plugin is
 * there to answer the compaction.
 */

/** What headspace reads to know headspace-cut is loaded and still running. */
export type HeadspaceCutState = { ready: boolean; seenAt: number }

declare module 'claude-code' {
  interface PluginState {
    'headspace-cut': {
      /** Written true at session start; unset means headspace-cut is not loaded. */
      ready: boolean
      /**
       * Its heartbeat: `$.clock.now()` at session start and at every main-loop
       * turn end. A value older than the last turn's start means it stopped
       * running (disabled during the session), whatever `ready` says.
       */
      seenAt: number
    }
  }
}
