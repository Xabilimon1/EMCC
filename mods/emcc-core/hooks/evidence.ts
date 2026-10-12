import type { EmccEvidenceKind } from '../types'

type CommandKind = Exclude<EmccEvidenceKind, 'edit'>

const PATTERNS: ReadonlyArray<readonly [CommandKind, RegExp]> = [
  [
    'test',
    /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|vitest|jest|pytest|python3?\s+-m\s+(?:pytest|unittest)|go\s+test|cargo\s+(?:test|nextest)|ctest|mocha|playwright\s+test|rspec|phpunit|dotnet\s+test|deno\s+test|claude\s+plugin\s+test)\b/,
  ],
  ['typecheck', /\b(?:tsc|vue-tsc|mypy|pyright|cargo\s+check|flow\s+check)\b/],
  [
    'lint',
    /\b(?:eslint|ruff|flake8|pylint|biome\s+(?:check|lint)|cargo\s+clippy|golangci-lint|stylelint|prettier\s+--check|claude\s+plugin\s+validate)\b/,
  ],
  [
    'build',
    /\b(?:(?:npm|pnpm|yarn|bun)\s+run\s+build|cargo\s+build|go\s+build|make|cmake\s+--build|ninja|vite\s+build|next\s+build|gradlew?\s+build|mvn\s+(?:package|install)|dotnet\s+build)\b/,
  ],
]

/**
 * The kinds a shell command runs, in the order checked: a chain such as
 * `npm run build && npm test` is both a build and a test.
 */
export function kindsOf(command: string): CommandKind[] {
  return PATTERNS.filter(([, pattern]) => pattern.test(command)).map(([kind]) => kind)
}

/**
 * The exit code of a finished command, from what the engine reported: 0 when
 * it did not error, the "Exit code N" the model read when it did, 1 when the
 * error carries no code.
 */
export function exitCodeOf(isError: boolean, text: string | undefined): number {
  if (!isError) {
    return 0
  }
  const match = /Exit code (\d+)/.exec(text ?? '')

  return match ? Number(match[1]) : 1
}
