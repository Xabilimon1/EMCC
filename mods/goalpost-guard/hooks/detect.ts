import type { GoalpostCategory, GoalpostFinding, GoalpostRule } from '../types'

/**
 * What the detectors look at, as the hooks module configured them.
 */
export type DetectOptions = {
  /** The categories that are on; a finding of any other is dropped. */
  categories: ReadonlySet<GoalpostCategory>
  /** An extra pattern for test files, on top of the usual names. */
  testPattern?: RegExp
}

/** One file as it was and as the change leaves it; `null` when it does not exist. */
export type FileChange = { path: string; before: string | null; after: string | null }

const CATEGORY_OF: Record<GoalpostRule, GoalpostCategory> = {
  'tests.assertions': 'tests',
  'tests.removed': 'tests',
  'tests.skipped': 'tests',
  'tests.focused': 'tests',
  'tests.loosened': 'tests',
  'tests.snapshots': 'tests',
  'tests.narrowed': 'tests',
  suppressions: 'suppressions',
  config: 'config',
  ci: 'ci',
  coverage: 'coverage',
  bypass: 'bypass',
  'shell-edit': 'tests',
}

const SAMPLE = 3

// ---------------------------------------------------------------- text helpers

function count(text: string, pattern: RegExp): number {
  return text.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))?.length ?? 0
}

/** The text without whole-line comments, so commenting a line out counts as removing it. */
function code(text: string): string {
  return text
    .split('\n')
    .filter(line => !/^\s*(?:\/\/|#(?![!\[])|\/\*|\*|--|<!--)/.test(line))
    .join('\n')
}

/** The lines of `after` that match `pattern` and were not in `before`, trimmed, at most a few. */
function addedLines(before: string, after: string, global: RegExp): string[] {
  const pattern = new RegExp(global.source, global.flags.replace('g', ''))
  const held = new Map<string, number>()
  for (const line of before.split('\n')) {
    held.set(line.trim(), (held.get(line.trim()) ?? 0) + 1)
  }
  const added: string[] = []
  for (const line of after.split('\n')) {
    const key = line.trim()
    const left = held.get(key) ?? 0
    if (left > 0) {
      held.set(key, left - 1)
    } else if (pattern.test(line)) {
      added.push(key)
    }
  }

  return added.slice(0, SAMPLE)
}

/** The lines of `before` that match `pattern` and are gone from `after`. */
function removedLines(before: string, after: string, pattern: RegExp): string[] {
  return addedLines(after, before, pattern)
}

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

// ---------------------------------------------------------------- tests

const TEST_PATH = [
  /(?:^|\/)(?:tests?|__tests__|specs?|e2e)\//,
  /\.(?:test|spec|e2e)\.[cm]?[jt]sx?$/,
  /(?:^|\/)test_[^/]*\.py$/,
  /_test\.(?:py|go|exs?)$/,
  /(?:Test|Tests|Spec)\.(?:java|kt|cs|swift|scala)$/,
  /_spec\.rb$/,
  /\.(?:test|spec)\.(?:php|dart)$/,
]

export function isTestFile(path: string, extra?: RegExp): boolean {
  return TEST_PATH.some(pattern => pattern.test(path)) || (extra?.test(path) ?? false)
}

const ASSERTION =
  /\bexpect\s*\(|\bassert(?:\.\w+|_\w+|[A-Z]\w*)?\s*!?\s*\(|\bassert\s+(?=[^\s(=:])|\.should\b|\bt\.(?:Errorf?|Fatalf?|Fail(?:Now)?)\s*\(|\brequire\.[A-Z]\w*\s*\(|\bXCTAssert\w*\s*\(|\bpytest\.raises\s*\(/g

const TEST_CASE =
  /\b[xf]?(?:it|test|specify)(?:\.(?:skip|only|todo|concurrent|failing|each\s*\(.*?\)))*\s*\(\s*['"`]|\bdef\s+test\w*\s*\(|\bfunc\s+Test\w*\s*\(|#\[(?:tokio::)?test\]|@Test\b|\bfn\s+test_\w*\s*\(/g

const SKIP =
  /\b(?:it|test|describe|context|suite|specify)\.(?:skip|todo)\b|\bx(?:it|describe|test|context|specify)\s*\(|@pytest\.mark\.(?:skip|skipif|xfail)\b|@unittest\.(?:skip|skipIf|skipUnless|expectedFailure)\b|\bpytest\.(?:skip|xfail)\s*\(|\bt\.Skip(?:f|Now)?\s*\(|#\[ignore\b|@(?:Disabled|Ignore)\b|\bpending\s*\(|\bself\.skipTest\s*\(|\bmarkTestSkipped\s*\(/g

const FOCUS = /\b(?:it|test|describe|context|suite|specify)\.only\b|\bf(?:it|describe|context)\s*\(/g

const STRONG =
  /\.(?:toBe|toEqual|toStrictEqual|toHaveBeenCalledWith|toHaveBeenCalledTimes|toThrow|toThrowError|toMatchObject|toContain|toHaveLength|toHaveProperty|toMatchSnapshot|toMatchInlineSnapshot)\s*\(|\bassert(?:Equals?|_eq|_ne|NotEqual|Raises|Is|In|Count(?:Equal)?|DictEqual|ListEqual|AlmostEqual|Same|Throws)\s*!?\s*\(|\bassert\b[^\n]*(?:==|!=|\bin\b|\bis\b)/g

const WEAK =
  /\.(?:toBeTruthy|toBeDefined|toBeFalsy|toBeInstanceOf|toBeCloseTo|toHaveBeenCalled|toBeGreaterThanOrEqual\s*\(\s*0\s*\)|toBeGreaterThan\s*\(\s*-?1\s*\))\s*\(|\.not\.(?:toBeNull|toBeUndefined|toThrow)\s*\(|\bassert(?:True|IsNotNone|IsInstance|Truthy)\s*\(|\bassert\s+\w+(?:\.\w+)*\s*$|\.toMatch\s*\(\s*\/\.\*\/|expect\.anything\s*\(/gm

const SNAPSHOT_FILE = /(?:__snapshots__\/|\.snap$|\.ambr$|__image_snapshots__\/)/

function testFindings(change: FileChange, testPattern?: RegExp): GoalpostFinding[] {
  const { path, before, after } = change
  const isTest = isTestFile(path, testPattern) || /#\[cfg\(test\)\]/.test(before ?? '')
  const found: GoalpostFinding[] = []

  if (SNAPSHOT_FILE.test(path) && before !== null && before !== after) {
    found.push({
      rule: 'tests.snapshots',
      file: path,
      title: after === null ? 'deletes a snapshot' : 'rewrites a snapshot',
      detail: `${basename(path)} is a recorded expectation; changing it by hand makes the test agree with the code`,
    })
  }
  if (!isTest || before === null) {
    if (isTest && after !== null) {
      const skips = count(code(after), SKIP)
      const focus = count(code(after), FOCUS)
      if (skips > 0) {
        found.push({
          rule: 'tests.skipped',
          file: path,
          title: `adds a test file with ${plural(skips, 'skipped test')}`,
          detail: `${addedLines('', after, SKIP).join(' | ')}`,
          after: addedLines('', after, SKIP),
        })
      }
      if (focus > 0) {
        found.push({
          rule: 'tests.focused',
          file: path,
          title: 'adds a focused test (.only)',
          detail: `only the focused tests run, the rest are silently skipped`,
          after: addedLines('', after, FOCUS),
        })
      }
    }

    return found
  }

  const was = code(before)
  const now = code(after ?? '')

  if (after === null) {
    const cases = count(was, TEST_CASE)
    found.push({
      rule: 'tests.removed',
      file: path,
      title: `deletes a test file${cases > 0 ? ` (${plural(cases, 'test')})` : ''}`,
      detail: `the file and its ${plural(count(was, ASSERTION), 'assertion')} go away`,
    })

    return found
  }

  const casesBefore = count(was, TEST_CASE)
  const casesAfter = count(now, TEST_CASE)
  if (casesAfter < casesBefore) {
    found.push({
      rule: 'tests.removed',
      file: path,
      title: `removes ${plural(casesBefore - casesAfter, 'test')}`,
      detail: `${casesBefore} → ${casesAfter} tests`,
      before: removedLines(before, after, TEST_CASE),
    })
  }

  const assertsBefore = count(was, ASSERTION)
  const assertsAfter = count(now, ASSERTION)
  if (assertsAfter < assertsBefore) {
    found.push({
      rule: 'tests.assertions',
      file: path,
      title: `removes ${plural(assertsBefore - assertsAfter, 'assertion')}`,
      detail: `${assertsBefore} → ${assertsAfter} assertions`,
      before: removedLines(before, after, ASSERTION),
    })
  }

  if (count(now, SKIP) > count(was, SKIP)) {
    found.push({
      rule: 'tests.skipped',
      file: path,
      title: `skips ${plural(count(now, SKIP) - count(was, SKIP), 'test')}`,
      detail: `a skipped test still reads as passing`,
      after: addedLines(before, after, SKIP),
    })
  }

  if (count(now, FOCUS) > count(was, FOCUS)) {
    found.push({
      rule: 'tests.focused',
      file: path,
      title: 'focuses a test (.only)',
      detail: `only the focused tests run, the rest are silently skipped`,
      after: addedLines(before, after, FOCUS),
    })
  }

  const weakUp = count(now, WEAK) - count(was, WEAK)
  const strongDown = count(was, STRONG) - count(now, STRONG)
  if (weakUp > 0 && strongDown > 0) {
    found.push({
      rule: 'tests.loosened',
      file: path,
      title: `loosens ${plural(Math.min(weakUp, strongDown), 'assertion')}`,
      detail: `exact checks traded for ones that pass on almost anything`,
      before: removedLines(before, after, STRONG),
      after: addedLines(before, after, WEAK),
    })
  }

  return found
}

// ---------------------------------------------------------------- suppressions

const SUPPRESSIONS: ReadonlyArray<readonly [string, RegExp]> = [
  ['@ts-ignore', /@ts-ignore\b/],
  ['@ts-expect-error', /@ts-expect-error\b/],
  ['@ts-nocheck', /@ts-nocheck\b/],
  ['eslint-disable', /eslint-disable(?:-next-line|-line)?\b/],
  ['biome-ignore', /biome-ignore\b/],
  ['oxlint-disable', /oxlint-disable\b/],
  ['# noqa', /#\s*noqa\b/],
  ['# type: ignore', /#\s*type:\s*ignore\b/],
  ['pyright: ignore', /pyright:\s*ignore\b/],
  ['pylint: disable', /pylint:\s*disable\b/],
  ['mypy: ignore-errors', /mypy:\s*ignore-errors\b/],
  ['//nolint', /\/\/\s*nolint\b/],
  ['#[allow(...)]', /#!?\[allow\(/],
  ['@SuppressWarnings', /@SuppressWarnings\b/],
  ['rubocop:disable', /rubocop:disable\b/],
  ['swiftlint:disable', /swiftlint:disable\b/],
  ['NOLINT', /\bNOLINT(?:NEXTLINE|BEGIN)?\b/],
  ['@phpstan-ignore', /@phpstan-ignore/],
  ['@psalm-suppress', /@psalm-suppress\b/],
  ['#pragma warning disable', /#pragma\s+warning\s+disable\b/],
  ['coverage ignore', /(?:istanbul|c8|v8)\s+ignore\b|pragma:\s*no\s*cover\b/],
]

const PROSE = /\.(?:md|mdx|markdown|txt|rst|adoc)$/

function suppressionFindings({ path, before, after }: FileChange): GoalpostFinding[] {
  if (after === null || PROSE.test(path)) {
    return []
  }
  const added: string[] = []
  const lines: string[] = []
  for (const [name, pattern] of SUPPRESSIONS) {
    const more = count(after, pattern) - count(before ?? '', pattern)
    if (more > 0) {
      added.push(more > 1 ? `${more}× ${name}` : name)
      lines.push(...addedLines(before ?? '', after, pattern))
    }
  }
  if (added.length === 0) {
    return []
  }

  return [
    {
      rule: 'suppressions',
      file: path,
      title: `adds ${added.join(', ')}`,
      detail: `the check still runs, it just stops reporting here`,
      after: lines.slice(0, SAMPLE),
    },
  ]
}

// ---------------------------------------------------------------- config

const TS_CONFIG = /(?:^|\/)[jt]sconfig(?:\.[\w-]+)?\.json$/
const TS_STRICT = [
  'strict',
  'noImplicitAny',
  'strictNullChecks',
  'strictFunctionTypes',
  'strictBindCallApply',
  'strictPropertyInitialization',
  'noImplicitThis',
  'useUnknownInCatchVariables',
  'alwaysStrict',
  'noUncheckedIndexedAccess',
  'exactOptionalPropertyTypes',
  'noImplicitReturns',
  'noImplicitOverride',
  'noFallthroughCasesInSwitch',
  'noUnusedLocals',
  'noUnusedParameters',
  'checkJs',
]
const COVERED_BY_STRICT = new Set([
  'noImplicitAny',
  'strictNullChecks',
  'strictFunctionTypes',
  'strictBindCallApply',
  'strictPropertyInitialization',
  'noImplicitThis',
  'useUnknownInCatchVariables',
  'alwaysStrict',
])

function flag(text: string, key: string): boolean | undefined {
  const match = new RegExp(`["']?\\b${key}\\b["']?\\s*[:=]\\s*(true|false|True|False)\\b`).exec(code(text))

  return match ? match[1]?.toLowerCase() === 'true' : undefined
}

const LINT_CONFIG =
  /(?:^|\/)(?:\.eslintrc(?:\.\w+)?|eslint\.config\.[cm]?[jt]s|\.oxlintrc\.json|biome\.jsonc?|\.stylelintrc(?:\.\w+)?|stylelint\.config\.[cm]?js|deno\.jsonc?)$/
const SEVERITY_RANK: Record<string, number> = { error: 2, '2': 2, warn: 1, '1': 1, info: 1, off: 0, '0': 0 }

function severities(text: string): Map<string, number> {
  const found = new Map<string, number>()
  const pattern = /['"]([@\w/.-]+)['"]\s*:\s*\[?\s*['"]?(error|warn|info|off|[012])\b/g
  for (const match of code(text).matchAll(pattern)) {
    const [, rule = '', level = ''] = match
    found.set(rule, SEVERITY_RANK[level] ?? 0)
  }

  return found
}

const PY_CONFIG = /(?:^|\/)(?:pyproject\.toml|setup\.cfg|tox\.ini|ruff\.toml|\.ruff\.toml|\.flake8|mypy\.ini|\.mypy\.ini|\.pylintrc|pylintrc)$/
const PY_STRICT = [
  'strict',
  'disallow_untyped_defs',
  'disallow_incomplete_defs',
  'disallow_any_generics',
  'check_untyped_defs',
  'warn_return_any',
  'no_implicit_optional',
  'strict_optional',
  'warn_unused_ignores',
]
const PY_LOOSE = ['ignore_errors', 'ignore_missing_imports', 'allow_untyped_defs', 'allow_redefinition']

function ignoredCodes(text: string): number {
  let total = 0
  const pattern = /\b(?:extend-ignore|ignore|disable|extend-per-file-ignores|per-file-ignores|ignore-names)\s*=\s*(\[[^\]]*\]|[^\n]*)/g
  for (const match of code(text).matchAll(pattern)) {
    total += count(match[1] ?? '', /\b[A-Z]{1,4}\d{1,4}\b|\b[a-z]+(?:-[a-z]+)+\b/g)
  }

  return total
}

function configFindings({ path, before, after }: FileChange): GoalpostFinding[] {
  if (before === null) {
    return []
  }
  const now = after ?? ''
  const weaker: string[] = []

  if (TS_CONFIG.test(path)) {
    const strictAfter = flag(now, 'strict') === true
    for (const key of TS_STRICT) {
      if (flag(before, key) === true && flag(now, key) !== true && !(strictAfter && COVERED_BY_STRICT.has(key))) {
        weaker.push(`${key} turned off`)
      }
    }
  }

  if (LINT_CONFIG.test(path)) {
    const was = severities(before)
    const is = severities(now)
    for (const [rule, rank] of was) {
      const level = is.get(rule)
      if (rank > 0 && level === undefined) {
        weaker.push(`${rule} removed`)
      } else if (level !== undefined && level < rank) {
        weaker.push(`${rule} ${rank === 2 ? 'error' : 'warn'} → ${level === 1 ? 'warn' : 'off'}`)
      }
    }
  }

  if (PY_CONFIG.test(path)) {
    for (const key of PY_STRICT) {
      if (flag(before, key) === true && flag(now, key) !== true) {
        weaker.push(`${key} turned off`)
      }
    }
    for (const key of PY_LOOSE) {
      if (flag(before, key) !== true && flag(now, key) === true) {
        weaker.push(`${key} turned on`)
      }
    }
    const more = ignoredCodes(now) - ignoredCodes(before)
    if (more > 0) {
      weaker.push(`${plural(more, 'more ignored rule')}`)
    }
  }

  if (after === null && (TS_CONFIG.test(path) || LINT_CONFIG.test(path))) {
    weaker.push('the whole file deleted')
  }

  if (weaker.length === 0) {
    return []
  }

  return [
    {
      rule: 'config',
      file: path,
      title: `relaxes ${basename(path)}`,
      detail: `${weaker.slice(0, 4).join(', ')}${weaker.length > 4 ? `, +${weaker.length - 4} more` : ''}`,
      after: weaker.slice(0, SAMPLE),
    },
  ]
}

// ---------------------------------------------------------------- CI

const CI_FILE =
  /(?:^|\/)(?:\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.ya?ml|\.circleci\/config\.ya?ml|azure-pipelines\.ya?ml|bitbucket-pipelines\.ya?ml|\.buildkite\/[^/]+\.ya?ml|Jenkinsfile|\.travis\.ya?ml|\.pre-commit-config\.ya?ml|lefthook\.ya?ml|\.husky\/[^/]+)$/

const CHECK_COMMAND =
  /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|typecheck|check|build)|vitest|jest|pytest|go\s+(?:test|vet)|cargo\s+(?:test|clippy|check|nextest)|ctest|mocha|playwright\s+test|rspec|phpunit|dotnet\s+test|tsc|mypy|pyright|eslint|ruff|flake8|pylint|biome|golangci-lint|stylelint|prettier\s+--check|pre-commit\s+run|claude\s+plugin\s+(?:test|validate))\b/g

const CI_SOFTENERS: ReadonlyArray<readonly [string, RegExp]> = [
  ['continue-on-error: true', /continue-on-error:\s*true\b/g],
  ['allow_failure: true', /allow_failure:\s*true\b/g],
  ['|| true', /\|\|\s*(?:true|:)\s*(?:$|[;&)])|\|\|\s*exit\s+0\b/gm],
  ['if: false', /\bif:\s*(?:false|\$\{\{\s*false\s*\}\})/g],
  ['set +e', /\bset\s+\+e\b/g],
]

function ciFindings({ path, before, after }: FileChange): GoalpostFinding[] {
  if (before === null || !CI_FILE.test(path)) {
    return []
  }
  const was = code(before)
  const now = code(after ?? '')
  const weaker: string[] = []
  const lines: string[] = []

  for (const [name, pattern] of CI_SOFTENERS) {
    const more = count(now, pattern) - count(was, pattern)
    if (more > 0) {
      weaker.push(more > 1 ? `${more}× ${name}` : name)
      lines.push(...addedLines(before, after ?? '', pattern))
    }
  }
  const checksGone = count(was, CHECK_COMMAND) - count(now, CHECK_COMMAND)
  if (checksGone > 0) {
    weaker.push(`${plural(checksGone, 'check')} removed`)
    lines.push(...removedLines(before, after ?? '', CHECK_COMMAND).map(line => `- ${line}`))
  }
  const hooksGone = count(was, /^\s*-\s+id:/gm) - count(now, /^\s*-\s+id:/gm)
  if (hooksGone > 0) {
    weaker.push(`${plural(hooksGone, 'hook')} removed`)
  }
  if (after === null) {
    weaker.push('the whole file deleted')
  }
  if (weaker.length === 0) {
    return []
  }

  return [
    {
      rule: 'ci',
      file: path,
      title: `weakens ${basename(path)}`,
      detail: `${weaker.join(', ')}`,
      after: lines.slice(0, SAMPLE),
    },
  ]
}

// ---------------------------------------------------------------- coverage

const COVERAGE_FILE =
  /(?:^|\/)(?:package\.json|jest\.config\.[\w.]+|vitest\.config\.[\w.]+|vite\.config\.[\w.]+|vitest\.workspace\.[\w.]+|pyproject\.toml|setup\.cfg|tox\.ini|\.coveragerc|pytest\.ini|codecov\.ya?ml|\.codecov\.ya?ml|\.nycrc(?:\.\w+)?|\.c8rc(?:\.\w+)?|karma\.conf\.[cm]?js|\.simplecov|Makefile|build\.gradle(?:\.kts)?|pom\.xml|\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.ya?ml)$/

const THRESHOLDS: ReadonlyArray<readonly [string, RegExp]> = [
  ['fail_under', /\bfail_under\s*[=:]\s*(\d+(?:\.\d+)?)/g],
  ['--cov-fail-under', /--cov-fail-under[= ](\d+(?:\.\d+)?)/g],
  ['--fail-under', /(?<!cov)--fail-under[= ](\d+(?:\.\d+)?)/g],
  ['branches', /["']?\bbranches["']?\s*:\s*(-?\d+(?:\.\d+)?)/g],
  ['functions', /["']?\bfunctions["']?\s*:\s*(-?\d+(?:\.\d+)?)/g],
  ['lines', /["']?\blines["']?\s*:\s*(-?\d+(?:\.\d+)?)/g],
  ['statements', /["']?\bstatements["']?\s*:\s*(-?\d+(?:\.\d+)?)/g],
  ['target', /\btarget:\s*(\d+(?:\.\d+)?)%?/g],
  ['minimum_coverage', /\bminimum_coverage\s*\(?\s*(\d+(?:\.\d+)?)/g],
  ['minimum', /<minimum>(\d*\.?\d+)<\/minimum>|\bminimum\s*=\s*(?:BigDecimal\s*\(\s*)?["']?(\d*\.?\d+)/g],
  ['--check-coverage', /--(?:lines|branches|functions|statements)[= ](\d+(?:\.\d+)?)/g],
]

function thresholds(text: string): Map<string, number[]> {
  const found = new Map<string, number[]>()
  for (const [name, pattern] of THRESHOLDS) {
    const values = [...code(text).matchAll(pattern)].map(match => Number(match[1] ?? match[2]))
    if (values.length > 0) {
      found.set(name, values)
    }
  }

  return found
}

function coverageFindings({ path, before, after }: FileChange): GoalpostFinding[] {
  if (before === null || after === null) {
    return []
  }
  if (!COVERAGE_FILE.test(path) && !/coverage|cov-fail|fail_under|codecov/i.test(before)) {
    return []
  }
  const relevant = /coverage|cov-fail|fail_under|codecov|threshold|minimum|jacoco|simplecov/i
  if (!relevant.test(before)) {
    return []
  }
  const was = thresholds(before)
  const is = thresholds(after)
  const lowered: string[] = []
  for (const [name, values] of was) {
    const now = is.get(name) ?? []
    values.forEach((value, index) => {
      const later = now[index]
      if (later === undefined && now.length < values.length) {
        lowered.push(`${name} ${value} removed`)
      } else if (later !== undefined && later < value) {
        lowered.push(`${name} ${value} → ${later}`)
      }
    })
  }
  if (lowered.length === 0) {
    return []
  }

  return [
    {
      rule: 'coverage',
      file: path,
      title: 'lowers a coverage threshold',
      detail: `${lowered.slice(0, 4).join(', ')}`,
      after: lowered.slice(0, SAMPLE),
    },
  ]
}

// ---------------------------------------------------------------- files

/**
 * Everything a change to one file does to lower the bar, in the categories
 * that are on.
 */
export function inspectChange(change: FileChange, options: DetectOptions): GoalpostFinding[] {
  if (change.before === change.after) {
    return []
  }
  const all = [
    ...testFindings(change, options.testPattern),
    ...suppressionFindings(change),
    ...configFindings(change),
    ...ciFindings(change),
    ...coverageFindings(change),
  ]

  return all.filter(finding => options.categories.has(CATEGORY_OF[finding.rule]))
}

/**
 * The file an Edit leaves, or null when `old` is not in it (the tool will
 * refuse the edit itself).
 */
export function applyEdit(before: string, old: string, replacement: string, isAll = false): string | null {
  if (old === '' || !before.includes(old)) {
    return null
  }

  return isAll ? before.split(old).join(replacement) : before.replace(old, () => replacement)
}

// ---------------------------------------------------------------- shell

/** The command with every quoted string emptied, so flags inside a message don't count. */
function withoutQuoted(command: string): string {
  return command.replace(/'[^']*'|"(?:\\.|[^"\\])*"|\$'[^']*'/g, '""').replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\1\b/g, '')
}

/** The words of the command, quotes taken off but their text kept. */
function words(command: string): string[] {
  return (command.match(/'[^']*'|"(?:\\.|[^"\\])*"|[^\s;&|()]+/g) ?? []).map(word => word.replace(/^['"]|['"]$/g, ''))
}

const GIT_VERB = (verb: string): RegExp => new RegExp(`\\bgit\\b(?:\\s+-[cC]\\s+\\S+)*\\s+${verb}\\b[^;&|]*`, 'g')

const SKIP_HOOK_ENV = /(?:^|[\s;&|(])(?:export\s+)?(HUSKY=0|HUSKY_SKIP_HOOKS=1|SKIP=\S+|LEFTHOOK=0|LEFTHOOK_EXCLUDE=\S+|PRE_COMMIT_ALLOW_NO_CONFIG=1|OVERCOMMIT_DISABLE=1)/

const RUNNER = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|vitest|jest|pytest|py\.test|go\s+test|cargo\s+(?:test|nextest)|mocha|playwright\s+test|rspec|phpunit|dotnet\s+test)\b/

const NARROWING: ReadonlyArray<readonly [string, RegExp]> = [
  ['--testPathIgnorePatterns', /--testPathIgnorePatterns\b/],
  ['--passWithNoTests', /--passWithNoTests\b/],
  ['--deselect', /--deselect\b/],
  ['-k "not …"', /\s-k\s+["']?not\b/],
  ['--ignore', /\s--ignore(?:-glob)?[= ]/],
  ['--exclude', /\s--exclude[= ]/],
  ['--skip', /\s--skip\b/],
  ['-p no:', /\s-p\s+no:/],
]

const SNAPSHOT_UPDATE = /\b(?:jest|vitest|playwright\s+test|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test)\b[^;&|]*\s(?:-u|--updateSnapshot|--update-snapshots|--update)\b|--snapshot-update\b|--snapshot-update\b|\binsta\s+accept\b|\bINSTA_UPDATE=always\b|UPDATE_SNAPSHOTS?=(?:1|true)/

const GUARDED_FOR_SHELL = (path: string, testPattern?: RegExp): GoalpostCategory | null => {
  if (isTestFile(path, testPattern) || SNAPSHOT_FILE.test(path)) {
    return 'tests'
  }
  if (CI_FILE.test(path)) {
    return 'ci'
  }
  if (TS_CONFIG.test(path) || LINT_CONFIG.test(path) || PY_CONFIG.test(path)) {
    return 'config'
  }

  return null
}

/**
 * Everything a shell command does to lower the bar: skipping git hooks,
 * deleting tests, narrowing or rewriting what a test run checks, and editing
 * a guarded file where no diff can be seen.
 */
export function inspectCommand(command: string, options: DetectOptions): GoalpostFinding[] {
  const plain = withoutQuoted(command)
  const found: GoalpostFinding[] = []

  const bypass: string[] = []
  for (const verb of ['commit', 'push', 'merge', 'am', 'rebase', 'cherry-pick', 'revert']) {
    for (const [segment] of plain.matchAll(GIT_VERB(verb))) {
      if (/\s--no-verify\b/.test(segment)) {
        bypass.push(`git ${verb} --no-verify`)
      } else if (verb === 'commit' && /\s-[a-zA-Z]*n[a-zA-Z]*(?=\s|$)/.test(segment)) {
        bypass.push('git commit -n')
      }
    }
  }
  const env = SKIP_HOOK_ENV.exec(plain)
  if (env) {
    bypass.push(env[1] ?? 'hook switch')
  }
  if (/\bgit\b[^;&|]*\bconfig\b[^;&|]*\bcore\.hooksPath\b/.test(plain)) {
    bypass.push('git config core.hooksPath')
  }
  if (bypass.length > 0) {
    found.push({
      rule: 'bypass',
      title: `skips the git hooks (${bypass[0]})`,
      detail: 'the checks a commit or push runs are switched off for this one',
      after: [command.slice(0, 200)],
    })
  }

  if (RUNNER.test(plain)) {
    const narrowed = NARROWING.filter(([, pattern]) => pattern.test(command)).map(([name]) => name)
    if (narrowed.length > 0) {
      found.push({
        rule: 'tests.narrowed',
        title: `runs the tests with ${narrowed.join(', ')}`,
        detail: 'a narrowed run can pass while the tests it leaves out fail',
        after: [command.slice(0, 200)],
      })
    }
  }
  if (SNAPSHOT_UPDATE.test(plain)) {
    found.push({
      rule: 'tests.snapshots',
      title: 'rewrites the snapshots',
      detail: 'updating snapshots makes every snapshot test agree with the code as it is now',
      after: [command.slice(0, 200)],
    })
  }

  const tokens = words(command)
  const deleting = /(?:^|[\s;&|(])(?:rm|unlink|trash|git\s+rm)\s/.test(plain)
  const editing = /(?:^|[\s;&|(])(?:sed\s+(?:-\w*\s+)*-i|perl\s+(?:-\w*\s+)*-[a-z]*i|gsed\s+-i)/.test(plain) || /(?<![<>&\d])>{1,2}\s*[^\s&>]/.test(plain)
  if (deleting || editing) {
    const guarded = tokens
      .map(token => [token, GUARDED_FOR_SHELL(token, options.testPattern)] as const)
      .filter((pair): pair is readonly [string, GoalpostCategory] => pair[1] !== null)
    const tests = guarded.filter(([, category]) => category === 'tests').map(([token]) => token)
    if (deleting && tests.length > 0) {
      found.push({
        rule: 'tests.removed',
        file: tests[0],
        title: `deletes ${tests.length === 1 ? 'a test file' : plural(tests.length, 'test file')}`,
        detail: tests.slice(0, SAMPLE).join(', '),
        before: tests.slice(0, SAMPLE),
      })
    } else if (editing && guarded.length > 0) {
      const [first] = guarded
      found.push({
        rule: 'shell-edit',
        file: first?.[0],
        title: `edits ${basename(first?.[0] ?? '')} from the shell`,
        detail: 'a guarded file changed where goalpost-guard cannot see the diff; use Edit so it can',
        after: [command.slice(0, 200)],
        category: first?.[1],
      })
    }
  }

  return found.filter(finding => options.categories.has(finding.category ?? CATEGORY_OF[finding.rule]))
}

export function categoryOf(finding: GoalpostFinding): GoalpostCategory {
  return finding.category ?? CATEGORY_OF[finding.rule]
}
