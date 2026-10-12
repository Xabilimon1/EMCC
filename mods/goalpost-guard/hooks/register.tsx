import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  GoalpostCategory,
  GoalpostDecision,
  GoalpostEntry,
  GoalpostException,
  GoalpostFinding,
} from '../types'
import { applyEdit, categoryOf, inspectChange, inspectCommand } from './detect'
import type { DetectOptions } from './detect'

const PANE = 'goalposts'
const KEEP = 100
const STORE_KEY = 'exceptions'
const TRAILERS = 10

// Anthropic's palette: clay for what was held, olive for what was let through,
// sky for standing exceptions, stone for everything secondary.
const CLAY = '#d97757'
const OLIVE = '#788c5d'
const SKY = '#6a9bcc'
const STONE = '#b0aea5'

const ledger = atom({ plugin: 'goalpost-guard', key: 'ledger' } as const, [])
const exceptions = atom({ plugin: 'goalpost-guard', key: 'exceptions' } as const, [])
const tab = atom({ plugin: 'goalpost-guard', key: 'tab' } as const, 'ledger')
const muted = atom({ plugin: 'goalpost-guard', key: 'muted' } as const, [])
const isPaused = atom({ plugin: 'goalpost-guard', key: 'isPaused' } as const, false)

type Mode = 'ask' | 'deny' | 'warn' | 'off'
type Configured = Mode | 'inherit'

const MODES: readonly Configured[] = ['inherit', 'ask', 'deny', 'warn', 'off']
const CATEGORIES: readonly GoalpostCategory[] = ['tests', 'suppressions', 'config', 'ci', 'coverage', 'bypass']

const CATEGORY_LABEL: Record<GoalpostCategory, string> = {
  tests: 'Tests: assertions, skips, .only, deleted tests, snapshots',
  suppressions: 'Suppressions: @ts-ignore, eslint-disable, noqa…',
  config: 'Config: tsconfig strictness, lint rules, mypy, ruff',
  ci: 'CI: continue-on-error, || true, removed checks and hooks',
  coverage: 'Coverage thresholds',
  bypass: 'Skipped git hooks: --no-verify, HUSKY=0, SKIP=',
}

const DECISION_LOOK: Record<GoalpostDecision, { label: string; color: string }> = {
  blocked: { label: 'HELD', color: CLAY },
  allowed: { label: 'ALLOWED', color: OLIVE },
  excepted: { label: 'EXCEPTION', color: SKY },
  warned: { label: 'NOTED', color: STONE },
}

const ANSWER = {
  block: 'Block it',
  once: 'Allow once',
  file: 'Allow in this file',
  project: 'Allow in this project',
} as const

type Settings = {
  mode: Configured
  categories: ReadonlySet<GoalpostCategory>
  testPattern?: RegExp
  ignore: readonly RegExp[]
  headless: 'deny' | 'allow'
  isTrailerOn: boolean
}

type Verdict = { kind: 'pass' } | { kind: 'warn'; note: string } | { kind: 'deny'; reason: string }

// ---------------------------------------------------------------- settings

function settingsOf(options: Record<string, unknown>): Settings {
  const mode = MODES.find(one => one === options.mode) ?? 'inherit'
  const categories = new Set(CATEGORIES.filter(category => options[category] !== false))
  let testPattern: RegExp | undefined
  if (typeof options.testPattern === 'string' && options.testPattern !== '') {
    try {
      testPattern = new RegExp(options.testPattern)
    } catch {
      testPattern = undefined
    }
  }
  const globs = Array.isArray(options.ignorePaths) ? options.ignorePaths : []

  return {
    mode,
    categories,
    testPattern,
    ignore: globs.filter((glob): glob is string => typeof glob === 'string' && glob !== '').map(globToRegExp),
    headless: options.headless === 'allow' ? 'allow' : 'deny',
    isTrailerOn: options.commitTrailer !== false,
  }
}

function globToRegExp(glob: string): RegExp {
  const body = glob
    .replace(/^\.\//, '')
    .replace(/\/+$/, '')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0001')
    .replace(/\*\*/g, '\u0002')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0001/g, '(?:.*/)?')
    .replace(/\u0002/g, '.*')

  return new RegExp(`(?:^|/)${body}(?:/.*)?$`)
}

function relative(path: string, cwd: string): string {
  return path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path
}

async function detectOptions($: EngineInterface, settings: Settings): Promise<DetectOptions> {
  const off = new Set(await read($, muted))

  return {
    categories: new Set([...settings.categories].filter(category => !off.has(category))),
    testPattern: settings.testPattern,
  }
}

/**
 * The EMCC profile, or null when emcc-core is not installed. `profile()` is
 * `off` while EMCC is halted, so the kill switch reaches this mod too.
 */
async function emccProfile($: EngineInterface): Promise<'standard' | 'strict' | 'off' | null> {
  try {
    return await $.emcc.profile()
  } catch {
    return null
  }
}

async function modeOf($: EngineInterface, configured: Configured): Promise<Mode> {
  if (await read($, isPaused)) {
    return 'off'
  }
  const profile = await emccProfile($)
  if (profile === 'off') {
    return 'off'
  }
  if (configured !== 'inherit') {
    return configured
  }

  return profile === 'strict' ? 'deny' : 'ask'
}

// ---------------------------------------------------------------- ledger, badge, exceptions

function summary(findings: readonly GoalpostFinding[], cwd: string): string {
  return findings.map(finding => `${finding.file ? `${relative(finding.file, cwd)} ` : ''}${finding.title}`).join('; ')
}

async function record(
  $: EngineInterface,
  tool: string,
  id: string,
  findings: readonly GoalpostFinding[],
  decision: GoalpostDecision,
  note?: string,
): Promise<void> {
  if (findings.length === 0) {
    return
  }
  const at = await $.clock.now()
  const entries: GoalpostEntry[] = findings.map((finding, index) => ({
    id: `${id}:${index}`,
    at,
    tool,
    finding,
    decision,
    ...(note === undefined ? {} : { note }),
  }))
  await update($, ledger, list => [...list, ...entries].slice(-KEEP))
  await refreshBadge($)
}

async function refreshBadge($: EngineInterface): Promise<void> {
  const list = await read($, ledger)
  const held = list.filter(entry => entry.decision === 'blocked').length
  const through = list.filter(entry => entry.decision !== 'blocked').length
  const parts = [held > 0 ? `${held} held` : '', through > 0 ? `${through} let through` : ''].filter(Boolean)
  try {
    await $.emcc.badge({
      id: 'goalpost-guard',
      text: parts.length > 0 ? `goalposts: ${parts.join(', ')}` : undefined,
      tone: through > 0 ? 'warn' : 'good',
    })
  } catch {
    // emcc-core is not installed: this mod draws its own line instead.
  }
}

function isCovered(exception: GoalpostException, finding: GoalpostFinding, project: string): boolean {
  return (
    exception.project === project &&
    exception.rule === finding.rule &&
    (exception.file === undefined || exception.file === finding.file)
  )
}

async function storedExceptions($: EngineInterface): Promise<GoalpostException[]> {
  const value = await $.store.get(STORE_KEY)

  return Array.isArray(value) ? (value as GoalpostException[]) : []
}

async function addExceptions(
  $: EngineInterface,
  findings: readonly GoalpostFinding[],
  scope: 'file' | 'project',
  note: string,
): Promise<void> {
  const project = await $.session.cwd()
  const at = await $.clock.now()
  const added: GoalpostException[] = findings.map(finding => ({
    project,
    rule: finding.rule,
    ...(scope === 'file' && finding.file !== undefined ? { file: finding.file } : {}),
    note,
    at,
  }))
  const kept = (await storedExceptions($)).filter(old => !added.some(one => sameException(one, old)))
  await $.store.set(STORE_KEY, [...kept, ...added])
  await update($, exceptions, () => [...kept, ...added].filter(one => one.project === project))
}

function sameException(a: GoalpostException, b: GoalpostException): boolean {
  return a.project === b.project && a.rule === b.rule && a.file === b.file
}

async function revokeException($: EngineInterface, gone: GoalpostException): Promise<void> {
  const kept = (await storedExceptions($)).filter(one => !sameException(one, gone))
  await $.store.set(STORE_KEY, kept)
  await update($, exceptions, list => list.filter(one => !sameException(one, gone)))
}

// ---------------------------------------------------------------- the gate

async function decide(
  $: EngineInterface,
  tool: string,
  id: string,
  found: readonly GoalpostFinding[],
  settings: Settings,
  mode: Mode,
): Promise<Verdict> {
  const cwd = await $.session.cwd()
  const watched = found.filter(
    finding => finding.file === undefined || !settings.ignore.some(glob => glob.test(relative(finding.file ?? '', cwd))),
  )
  const standing = await storedExceptions($)
  const excepted = watched.filter(finding => standing.some(one => isCovered(one, finding, cwd)))
  const open = watched.filter(finding => !excepted.includes(finding))
  await record($, tool, id, excepted, 'excepted')
  if (open.length === 0) {
    return { kind: 'pass' }
  }
  const what = summary(open, cwd)

  if (mode === 'warn') {
    await record($, tool, id, open, 'warned')

    return { kind: 'warn', note: `goalpost-guard noted that this change ${what}. Say so to the user in your summary.` }
  }
  if (mode === 'deny') {
    await record($, tool, id, open, 'blocked')

    return {
      kind: 'deny',
      reason:
        `goalpost-guard refused this change: it ${what}. ` +
        'This session does not let a check pass by lowering the bar. Fix the code instead, or ask the user to allow it.',
    }
  }
  if ((await $.session.surfaces()).length === 0) {
    if (settings.headless === 'allow') {
      await record($, tool, id, open, 'warned', 'no one could be asked')

      return { kind: 'warn', note: `goalpost-guard let this through unasked (no screen): it ${what}. Report it.` }
    }
    await record($, tool, id, open, 'blocked', 'no one could be asked')

    return {
      kind: 'deny',
      reason: `goalpost-guard held this change: it ${what}, and no one is here to allow it. Make the check pass without lowering the bar.`,
    }
  }

  const answer = await $.ui
    .ask(`Goalpost Guard: this ${tool === 'Bash' ? 'command' : 'change'} ${what}. Allow it?`, {
      header: 'Goalpost',
      options: [ANSWER.block, ANSWER.once, ANSWER.file, ANSWER.project],
    })
    .catch(() => ANSWER.block)

  if (answer === ANSWER.once) {
    await record($, tool, id, open, 'allowed')

    return { kind: 'pass' }
  }
  if (answer === ANSWER.file || answer === ANSWER.project) {
    await addExceptions($, open, answer === ANSWER.file ? 'file' : 'project', `allowed from the dialog: ${what}`)
    await record($, tool, id, open, 'allowed', answer === ANSWER.file ? 'from now on in this file' : 'from now on in this project')

    return { kind: 'pass' }
  }
  const said = answer === ANSWER.block ? undefined : answer.trim()
  await record($, tool, id, open, 'blocked', said)

  return {
    kind: 'deny',
    reason:
      `goalpost-guard held this change: it ${what}. The user blocked it. ` +
      (said ? `The user says: "${said}"` : 'Make the check pass without lowering the bar, or explain why the bar has to move.'),
  }
}

async function fileFindings(
  $: EngineInterface,
  path: string,
  toAfter: (before: string | null) => string | null | undefined,
  options: DetectOptions,
): Promise<GoalpostFinding[]> {
  const before = (await $.fs.exists(path)) ? await $.fs.read(path) : null
  const after = toAfter(before)
  if (after === undefined) {
    return []
  }

  return inspectChange({ path, before, after }, options)
}

function heldForError(error: unknown): Verdict {
  const why = error instanceof Error ? error.message : String(error)

  return {
    kind: 'deny',
    reason: `goalpost-guard could not check this change (${why.slice(0, 200)}), so it held it. The user can run /goalposts pause to let changes through.`,
  }
}

// ---------------------------------------------------------------- commit trailers

const COMMIT = /\bgit\b(?:\s+-[cC]\s+\S+)*\s+commit\b/g

function quoted(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

const TRAILER_WORDS: Record<GoalpostDecision, string> = {
  blocked: 'held',
  allowed: 'allowed by the user',
  excepted: 'standing exception',
  warned: 'let through and reported',
}

function trailerOf(entry: GoalpostEntry, cwd: string): string {
  const where = entry.finding.file ? `${relative(entry.finding.file, cwd)}: ` : ''
  const why = entry.note ? `: ${entry.note}` : ''

  return `Goalpost-Change: ${where}${entry.finding.title} (${TRAILER_WORDS[entry.decision]}${why})`.replace(/\s+/g, ' ').slice(0, 240)
}

/** The command with `--trailer` lines after its first `git commit` outside quotes, or null without one. */
function withTrailers(command: string, entries: readonly GoalpostEntry[], cwd: string): string | null {
  const quotedSpans = [...command.matchAll(/'[^']*'|"(?:\\.|[^"\\])*"/g)].map(match => [match.index, match.index + match[0].length])
  for (const match of command.matchAll(COMMIT)) {
    const at = match.index
    if (quotedSpans.some(([from = 0, to = 0]) => at > from && at < to)) {
      continue
    }
    const end = at + match[0].length
    const flags = entries.map(entry => ` --trailer ${quoted(trailerOf(entry, cwd))}`).join('')

    return command.slice(0, end) + flags + command.slice(end)
  }

  return null
}

// ---------------------------------------------------------------- audit

async function audit($: EngineInterface, base: string, options: DetectOptions): Promise<string> {
  const listed = await $.process.run(['git', 'diff', '--name-status', '-M', base])
  if (listed.exitCode !== 0) {
    return `git diff ${base} failed: ${listed.stderr.trim().slice(0, 200)}`
  }
  const untracked = await $.process.run(['git', 'ls-files', '--others', '--exclude-standard'])
  const rows = listed.stdout
    .split('\n')
    .filter(Boolean)
    .map(line => line.split('\t'))
  for (const path of untracked.stdout.split('\n').filter(Boolean)) {
    rows.push(['A', path])
  }
  const cwd = await $.session.cwd()
  const found: GoalpostFinding[] = []
  for (const [status = '', first = '', second] of rows.slice(0, 300)) {
    const path = `${cwd}/${second ?? first}`
    const shown = await $.process.run(['git', 'show', `${base}:${first}`])
    const before = status.startsWith('A') || shown.exitCode !== 0 ? null : shown.stdout
    const after = status.startsWith('D') || !(await $.fs.exists(path)) ? null : await $.fs.read(path)
    found.push(...inspectChange({ path, before, after }, options))
  }
  if (found.length === 0) {
    return `Nothing in the changes since ${base} lowers the bar (${rows.length} files checked).`
  }

  return [
    `${found.length} ${found.length === 1 ? 'change lowers' : 'changes lower'} the bar since ${base}:`,
    ...found.map(finding => `- ${relative(finding.file ?? '', cwd)} ${finding.title}: ${finding.detail}`),
  ].join('\n')
}

// ---------------------------------------------------------------- register

export const register: Register = (on, options) => {
  const settings = settingsOf(options as Record<string, unknown>)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'goalposts',
      description: 'Goalpost Guard: open the ledger, or "audit [ref]", "pause", "resume"',
    })
    const project = await $.session.cwd()
    const standing = (await storedExceptions($)).filter(one => one.project === project)
    await update($, exceptions, () => standing)

    return next(e)
  })

  on('command.run', { command: 'goalposts' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    if (verb === 'pause' || verb === 'resume') {
      await update($, isPaused, () => verb === 'pause')

      return { text: verb === 'pause' ? 'Goalpost Guard paused for this session.' : 'Goalpost Guard is on again.' }
    }
    if (verb === 'audit') {
      return { text: await audit($, rest[0] ?? 'HEAD', await detectOptions($, settings)) }
    }
    const opened = await $.ui.open({ id: PANE, title: 'Goalpost Guard', focus: true })
    if (!opened.isPlaced) {
      const list = await read($, ledger)

      return {
        text:
          list.length === 0
            ? 'Goalpost Guard has not held anything this session.'
            : list.map(entry => `${DECISION_LOOK[entry.decision].label} ${entry.finding.title} ${entry.finding.file ?? ''}`).join('\n'),
      }
    }

    return { text: 'Goalpost Guard ledger opened.' }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const mode = await modeOf($, settings.mode)
    if (mode === 'off') {
      return next(e)
    }
    let verdict: Verdict
    try {
      const found = await fileFindings(
        $,
        e.file_path,
        before => (before === null ? undefined : (applyEdit(before, e.old_string, e.new_string, e.replace_all === true) ?? undefined)),
        await detectOptions($, settings),
      )
      verdict = await decide($, 'Edit', e.tool_use_id, found, settings, mode)
    } catch (error) {
      verdict = heldForError(error)
    }
    if (verdict.kind === 'deny') {
      return { deny: verdict.reason }
    }
    const ran = await next(e)
    if (verdict.kind === 'warn' && ran.deny === undefined) {
      return { ...ran, context: [...(ran.context ?? []), verdict.note] }
    }

    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const mode = await modeOf($, settings.mode)
    if (mode === 'off') {
      return next(e)
    }
    let verdict: Verdict
    try {
      const found = await fileFindings($, e.file_path, () => e.content, await detectOptions($, settings))
      verdict = await decide($, 'Write', e.tool_use_id, found, settings, mode)
    } catch (error) {
      verdict = heldForError(error)
    }
    if (verdict.kind === 'deny') {
      return { deny: verdict.reason }
    }
    const ran = await next(e)
    if (verdict.kind === 'warn' && ran.deny === undefined) {
      return { ...ran, context: [...(ran.context ?? []), verdict.note] }
    }

    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const mode = await modeOf($, settings.mode)
    if (mode === 'off') {
      return next(e)
    }
    let verdict: Verdict
    try {
      const found = inspectCommand(e.command, await detectOptions($, settings))
      verdict = await decide($, 'Bash', e.tool_use_id, found, settings, mode)
    } catch (error) {
      verdict = heldForError(error)
    }
    if (verdict.kind === 'deny') {
      return { deny: verdict.reason }
    }

    const cwd = await $.session.cwd()
    const unreported = settings.isTrailerOn
      ? (await read($, ledger)).filter(entry => entry.decision !== 'blocked' && entry.isReported !== true).slice(-TRAILERS)
      : []
    const rewritten = unreported.length > 0 ? withTrailers(e.command, unreported, cwd) : null
    const ran = await next(rewritten === null ? e : { ...e, command: rewritten })
    if (rewritten !== null && ran.deny === undefined && ran.isError !== true) {
      const done = new Set(unreported.map(entry => entry.id))
      await update($, ledger, list => list.map(entry => (done.has(entry.id) ? { ...entry, isReported: true } : entry)))
    }
    if (verdict.kind === 'warn' && ran.deny === undefined) {
      return { ...ran, context: [...(ran.context ?? []), verdict.note] }
    }

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await emccProfile($)) !== null) {
      return next(e)
    }
    const list = await read($, ledger)
    const paused = await read($, isPaused)
    if (list.length === 0 && !paused) {
      return next(e)
    }
    const held = list.filter(entry => entry.decision === 'blocked').length
    const through = list.length - held
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text color={CLAY} bold>
          Goalpost Guard{' '}
        </Text>
        {paused && <Text color={STONE}>paused </Text>}
        {held > 0 && <Text color={CLAY}>{held} held </Text>}
        {through > 0 && <Text color={OLIVE}>{through} let through </Text>}
        <Button key="ledger" label="Ledger" onPress={() => $.ui.open({ id: PANE, title: 'Goalpost Guard', focus: true })} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const shown = await read($, tab)
    const list = await read($, ledger)
    const standing = await read($, exceptions)
    const off = await read($, muted)
    const paused = await read($, isPaused)
    const mode = await modeOf($, settings.mode)
    const cwd = await $.session.cwd()
    const held = list.filter(entry => entry.decision === 'blocked').length
    const room = Math.max(3, Math.floor(((e.viewport?.rows ?? 24) - 6) / 4))

    const tabs = (
      <Box gap={1}>
        <Button key="tab-ledger" label={`Ledger ${list.length}`} variant={shown === 'ledger' ? 'primary' : undefined} onPress={() => update($, tab, () => 'ledger')} />
        <Button key="tab-exceptions" label={`Exceptions ${standing.length}`} variant={shown === 'exceptions' ? 'primary' : undefined} onPress={() => update($, tab, () => 'exceptions')} />
        <Button key="tab-rules" label="Rules" variant={shown === 'rules' ? 'primary' : undefined} onPress={() => update($, tab, () => 'rules')} />
        <Button key="pause" label={paused ? 'Resume' : 'Pause'} onPress={() => update($, isPaused, value => !value)} />
        <Button key="close" label="Close" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
      </Box>
    )
    const status = (
      <Text>
        <Text color={STONE}>mode </Text>
        <Text color={mode === 'off' ? STONE : CLAY} bold>
          {mode}
        </Text>
        <Text color={STONE}>
          {settings.mode === 'inherit' && mode !== 'off' ? ' (inherited)' : ''}
          {'   '}
          {held} held, {list.length - held} let through
        </Text>
      </Text>
    )

    if (shown === 'exceptions') {
      return (
        <Box flexDirection="column" gap={1}>
          {tabs}
          {status}
          {standing.length === 0 && <Text color={STONE}>No standing exceptions in this project.</Text>}
          {standing.map(one => (
            <Box key={`exception-${one.rule}-${one.file ?? '*'}`} flexDirection="column">
              <Text>
                <Text color={SKY} bold>
                  {one.rule}
                </Text>
                <Text> {one.file ? relative(one.file, cwd) : 'anywhere in this project'}</Text>
              </Text>
              <Text color={STONE}>{one.note}</Text>
              <Button key={`revoke-${one.rule}-${one.file ?? '*'}`} label="Revoke" onPress={() => revokeException($, one)} />
            </Box>
          ))}
        </Box>
      )
    }

    if (shown === 'rules') {
      return (
        <Box flexDirection="column" gap={1}>
          {tabs}
          {status}
          {CATEGORIES.map(category => {
            const isConfigured = settings.categories.has(category)
            const isOn = isConfigured && !off.includes(category)

            return (
              <Box key={`rule-${category}`} gap={1}>
                <Text color={isOn ? OLIVE : STONE} bold>
                  {isOn ? 'on ' : 'off'}
                </Text>
                <Text color={isOn ? undefined : STONE}>{CATEGORY_LABEL[category]}</Text>
                {isConfigured ? (
                  <Button
                    key={`toggle-${category}`}
                    label={isOn ? 'Mute' : 'Unmute'}
                    onPress={() => update($, muted, now => (now.includes(category) ? now.filter(one => one !== category) : [...now, category]))}
                  />
                ) : (
                  <Text color={STONE}>(off in /config)</Text>
                )}
              </Box>
            )
          })}
          <Text color={STONE}>Mute lasts this session; /config changes it for good.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {tabs}
        {status}
        {list.length === 0 && <Text color={STONE}>Nothing held yet. Changes that lower the bar show up here.</Text>}
        {[...list]
          .reverse()
          .slice(0, room)
          .map(entry => {
            const look = DECISION_LOOK[entry.decision]

            return (
              <Box key={`entry-${entry.id}`} flexDirection="column">
                <Text>
                  <Text color={look.color} bold inverse>
                    {` ${look.label} `}
                  </Text>
                  <Text color={STONE}> {categoryOf(entry.finding)} </Text>
                  <Text>{entry.finding.file ? relative(entry.finding.file, cwd) : entry.tool}</Text>
                </Text>
                <Text bold>{entry.finding.title}</Text>
                {(entry.finding.before ?? []).map(line => (
                  <Text color={CLAY} wrap="truncate-end">
                    {`  - ${line}`}
                  </Text>
                ))}
                {(entry.finding.after ?? []).map(line => (
                  <Text color={SKY} wrap="truncate-end">
                    {`  + ${line}`}
                  </Text>
                ))}
                {entry.note !== undefined && <Text color={STONE} italic>{`  ${entry.note}`}</Text>}
                {entry.decision === 'blocked' && entry.finding.file !== undefined && (
                  <Button
                    key={`allow-${entry.id}`}
                    label="Allow in this file"
                    onPress={() => addExceptions($, [entry.finding], 'file', 'allowed from the ledger')}
                  />
                )}
              </Box>
            )
          })}
      </Box>
    )
  })
}
