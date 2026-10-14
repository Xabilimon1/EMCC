import type { Register } from 'claude-code'

const COMMAND = 'headspace'

// The scaffold: `/headspace` answers so the mod loads. The bar, the pane and the hooks come in later tasks.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: COMMAND, description: 'headspace: open the pane on your rules' })
    } catch {
      // A failed registration leaves the session as it was.
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async () => ({ text: 'headspace' }))
}
