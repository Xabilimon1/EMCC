import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { EmccBadge, EmccEvidence, EmccEvidenceKind, EmccFlag, EmccProfile, EmccTone } from '../types'
import { exitCodeOf, kindsOf } from './evidence'

const evidence = atom({ plugin: 'emcc-core', key: 'evidence' } as const, [])
const badges = atom({ plugin: 'emcc-core', key: 'badges' } as const, [])
const isHalted = atom({ plugin: 'emcc-core', key: 'isHalted' } as const, false)

const KEEP = 200
const SHOWN: readonly EmccEvidenceKind[] = ['test', 'typecheck', 'lint', 'build']
// Anthropic's palette: olive for what holds, clay for what needs a look,
// stone for everything secondary.
const OLIVE = '#788c5d'
const CLAY = '#d97757'
const STONE = '#b0aea5'

const TONE_COLOR: Record<EmccTone, string | undefined> = {
  neutral: undefined,
  good: OLIVE,
  warn: CLAY,
  bad: CLAY,
}

const PROFILES: readonly EmccProfile[] = ['standard', 'strict', 'off']

function configuredProfile(value: unknown): EmccProfile {
  return PROFILES.find(profile => profile === value) ?? 'standard'
}

function latestOf(list: readonly EmccEvidence[], kind: EmccEvidenceKind): EmccEvidence | null {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index]
    if (item?.kind === kind) {
      return item
    }
  }

  return null
}

function summaryOf(item: EmccEvidence): string {
  return item.isOk ? `${item.kind} pass` : `${item.kind} FAIL ${item.exitCode ?? ''}`.trim()
}

async function record($: EngineInterface, item: EmccEvidence): Promise<void> {
  await update($, evidence, list => [...list, item].slice(-KEEP))
}

export const register: Register = (on, options) => {
  const configured = configuredProfile(options.profile)

  on('engine.create', async (_$, e, next) => {
    const beneath = await next(e)

    const emcc: EngineInterface['emcc'] = {
      evidenceLatest: async ({ kind }) => {
        const { value = [] } = await beneath.state.get({ plugin: 'emcc-core', key: 'evidence' })

        return latestOf(value, kind)
      },
      evidenceSince: async ({ at }) => {
        const { value = [] } = await beneath.state.get({ plugin: 'emcc-core', key: 'evidence' })

        return value.filter(item => item.at >= at)
      },
      badge: async ({ id, text, tone }) => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const held = await beneath.state.get({ plugin: 'emcc-core', key: 'badges' })
          const others = (held.value ?? []).filter(slot => slot.id !== id)
          const slot: EmccBadge = { id, text: text ?? '', tone: tone ?? 'neutral' }
          const shown = text === undefined || text === '' ? others : [...others, slot]
          const written = await beneath.state.set({ plugin: 'emcc-core', key: 'badges' }, shown, {
            ifVersion: held.version,
          })
          if (written.isSet) {
            return
          }
        }
        throw new Error('emcc-core: the badges kept changing; try again')
      },
      profile: async () => {
        const { value = false } = await beneath.state.get({ plugin: 'emcc-core', key: 'isHalted' })

        return value ? 'off' : configured
      },
      isHalted: async () => {
        const { value = false } = await beneath.state.get({ plugin: 'emcc-core', key: 'isHalted' })

        return value
      },
      flag: async ({ source, rule, file, text }) => {
        const raised: EmccFlag = { source, rule, ...(file === undefined ? {} : { file }), text, at: await beneath.clock.now() }
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const held = await beneath.state.get({ plugin: 'emcc-core', key: 'flags' })
          const written = await beneath.state.set(
            { plugin: 'emcc-core', key: 'flags' },
            [...(held.value ?? []), raised].slice(-KEEP),
            { ifVersion: held.version },
          )
          if (written.isSet) {
            return
          }
        }
        throw new Error('emcc-core: the flags kept changing; try again')
      },
      flagsSince: async ({ at }) => {
        const { value = [] } = await beneath.state.get({ plugin: 'emcc-core', key: 'flags' })

        return value.filter(item => item.at >= at)
      },
      kindsOf: async ({ command }) => kindsOf(command),
    }

    const added = { emcc }

    return { ...added, ...beneath }
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'emcc', description: 'Show the EMCC profile, evidence and badges' })
    await $.command.register({ name: 'emcc-halt', description: 'Turn every EMCC gate off for this session, or back on' })

    return next(e)
  })

  on('command.run', { command: 'emcc' }, async $ => {
    const list = await read($, evidence)
    const profile = (await read($, isHalted)) ? 'off' : configured
    const facts = SHOWN.map(kind => latestOf(list, kind))
      .filter((item): item is EmccEvidence => item !== null)
      .map(summaryOf)
    const slots = (await read($, badges)).map(slot => `${slot.id}: ${slot.text}`)
    const lines = [
      `EMCC profile: ${profile}${(await read($, isHalted)) ? ' (halted)' : ''}`,
      `Evidence: ${facts.length > 0 ? facts.join(', ') : 'none yet'}`,
      `Badges: ${slots.length > 0 ? slots.join(', ') : 'none'}`,
    ]

    return { text: lines.join('\n') }
  })

  on('command.run', { command: 'emcc-halt' }, async $ => {
    const now = await update($, isHalted, halted => !halted)

    return { text: now ? 'EMCC halted: every gate is off until /emcc-halt again.' : 'EMCC resumed.' }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const kinds = kindsOf(e.command)
    const isBackground = ran.deny === undefined && !ran.isError && ran.result.backgroundTaskId !== undefined
    if (ran.deny !== undefined || kinds.length === 0 || isBackground) {
      return ran
    }
    const exitCode = exitCodeOf(ran.isError === true, ran.text)
    const at = await $.clock.now()
    for (const kind of kinds) {
      await record($, { kind, at, command: e.command.slice(0, 200), exitCode, isOk: exitCode === 0 })
    }

    return ran
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      await record($, { kind: 'edit', at: await $.clock.now(), file: e.file_path })
    }

    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      await record($, { kind: 'edit', at: await $.clock.now(), file: e.file_path })
    }

    return ran
  })

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      await record($, { kind: 'edit', at: await $.clock.now(), file: e.notebook_path })
    }

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const halted = await read($, isHalted)
    if (e.props.hasSurvey || (configured === 'off' && !halted)) {
      return next(e)
    }
    const list = await read($, evidence)
    const facts = SHOWN.map(kind => latestOf(list, kind)).filter((item): item is EmccEvidence => item !== null)
    const slots = await read($, badges)
    if (!halted && facts.length === 0 && slots.length === 0) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text color={CLAY} bold>
          EMCC{' '}
        </Text>
        <Text color={STONE}>{halted ? 'halted' : configured} </Text>
        {facts.map(item => (
          <Text color={item.isOk ? OLIVE : CLAY} bold={!item.isOk}>
            {summaryOf(item)}{' '}
          </Text>
        ))}
        {slots.map(slot => (
          <Text color={TONE_COLOR[slot.tone]} bold={slot.tone === 'bad'}>
            {slot.text}{' '}
          </Text>
        ))}
        <Button
          key="halt"
          label={halted ? 'Resume' : 'Halt'}
          onPress={() => update($, isHalted, value => !value)}
        />
      </Box>
    )
  })
}
