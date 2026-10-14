/**
 * headspace-cut's session state: whether it loaded, so headspace offers to
 * remove results only when this plugin is there to answer the compaction.
 */

/** What headspace reads to know headspace-cut is loaded. */
export type HeadspaceCutState = { ready: boolean }

declare module 'claude-code' {
  interface PluginState {
    'headspace-cut': {
      /** Written true at session start; unset means headspace-cut is not loaded. */
      ready: boolean
    }
  }
}
