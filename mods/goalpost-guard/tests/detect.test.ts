import { describe, expect, test } from 'claude-code/testing'

import { applyEdit, inspectChange, inspectCommand, isTestFile } from '../hooks/detect'
import type { DetectOptions } from '../hooks/detect'

const ALL: DetectOptions = {
  categories: new Set(['tests', 'suppressions', 'config', 'ci', 'coverage', 'bypass']),
}

function rules(path: string, before: string | null, after: string | null, options = ALL): string[] {
  return inspectChange({ path, before, after }, options).map(finding => finding.rule)
}

function commandRules(command: string, options = ALL): string[] {
  return inspectCommand(command, options).map(finding => finding.rule)
}

const SPEC = `
import { add } from './add'

describe('add', () => {
  it('adds', () => {
    expect(add(1, 2)).toBe(3)
    expect(add(0, 0)).toBe(0)
  })

  it('handles negatives', () => {
    expect(add(-1, 1)).toBe(0)
  })
})
`

describe('test files', () => {
  test('knows test files by their usual names', async () => {
    expect(isTestFile('src/add.test.ts')).toBe(true)
    expect(isTestFile('tests/test_api.py')).toBe(true)
    expect(isTestFile('pkg/server_test.go')).toBe(true)
    expect(isTestFile('src/test/java/AppTest.java')).toBe(true)
    expect(isTestFile('spec/user_spec.rb')).toBe(true)
    expect(isTestFile('src/add.ts')).toBe(false)
    expect(isTestFile('src/add.ts', /\/checks\//)).toBe(false)
    expect(isTestFile('src/checks/add.ts', /\/checks\//)).toBe(true)
  })

  test('a removed or commented-out assertion is caught, with the line it lost', async () => {
    const removed = SPEC.replace('    expect(add(0, 0)).toBe(0)\n', '')
    const [finding] = inspectChange({ path: 'src/add.test.ts', before: SPEC, after: removed }, ALL)
    expect(finding).toMatchObject({ rule: 'tests.assertions', title: 'removes 1 assertion' })
    expect(finding?.before).toEqual(['expect(add(0, 0)).toBe(0)'])

    const commented = SPEC.replace('    expect(add(0, 0))', '    // expect(add(0, 0))')
    expect(rules('src/add.test.ts', SPEC, commented)).toEqual(['tests.assertions'])
  })

  test('python, go and rust assertions count too', async () => {
    const py = 'def test_a():\n    assert f(1) == 2\n    self.assertEqual(f(2), 3)\n'
    expect(rules('tests/test_f.py', py, 'def test_a():\n    assert f(1) == 2\n')).toEqual(['tests.assertions'])
    const go = 'func TestF(t *testing.T) {\n  if f() != 1 {\n    t.Errorf("bad")\n  }\n  assert.Equal(t, 1, f())\n}\n'
    expect(rules('f_test.go', go, go.replace('  assert.Equal(t, 1, f())\n', ''))).toEqual(['tests.assertions'])
    const rs = '#[cfg(test)]\nmod tests {\n  #[test]\n  fn adds() {\n    assert_eq!(add(1, 2), 3);\n    assert!(ok());\n  }\n}\n'
    expect(rules('src/lib.rs', rs, rs.replace('    assert!(ok());\n', ''))).toEqual(['tests.assertions'])
  })

  test('a deleted test case is caught, and moving code around is not', async () => {
    const without = SPEC.replace(/\n  it\('handles negatives'[\s\S]*?\n  \}\)\n/, '\n')
    expect(rules('src/add.test.ts', SPEC, without)).toEqual(['tests.removed', 'tests.assertions'])
    const renamed = SPEC.replace("describe('add'", "describe('add numbers'")
    expect(rules('src/add.test.ts', SPEC, renamed)).toEqual([])
  })

  test('skip, todo, xit and the python and go skips are caught', async () => {
    expect(rules('src/add.test.ts', SPEC, SPEC.replace("it('handles", "it.skip('handles"))).toEqual(['tests.skipped'])
    expect(rules('src/add.test.ts', SPEC, SPEC.replace("it('handles", "xit('handles"))).toEqual(['tests.skipped'])
    const py = 'def test_a():\n    assert f(1) == 2\n'
    expect(rules('tests/test_f.py', py, `@pytest.mark.skip(reason="flaky")\n${py}`)).toEqual(['tests.skipped'])
    expect(rules('tests/test_f.py', py, `@pytest.mark.xfail\n${py}`)).toEqual(['tests.skipped'])
    const go = 'func TestF(t *testing.T) {\n  run(t)\n}\n'
    expect(rules('f_test.go', go, go.replace('  run(t)', '  t.Skip("later")\n  run(t)'))).toEqual(['tests.skipped'])
  })

  test('.only is caught', async () => {
    expect(rules('src/add.test.ts', SPEC, SPEC.replace("it('adds'", "it.only('adds'"))).toEqual(['tests.focused'])
  })

  test('trading an exact check for a loose one is caught', async () => {
    const loose = SPEC.replace('expect(add(1, 2)).toBe(3)', 'expect(add(1, 2)).toBeDefined()')
    const [finding] = inspectChange({ path: 'src/add.test.ts', before: SPEC, after: loose }, ALL)
    expect(finding).toMatchObject({ rule: 'tests.loosened' })
    expect(finding?.after).toEqual(['expect(add(1, 2)).toBeDefined()'])
  })

  test('rewriting the expected value of an assertion is caught, with both lines', async () => {
    const node = "test('tax', () => {\n  assert.equal(withTax(19.99, 0.21), 24.19)\n})\n"
    const [finding] = inspectChange({ path: 'test/cart.test.js', before: node, after: node.replace('24.19)', '24)') }, ALL)
    expect(finding).toMatchObject({ rule: 'tests.expected', title: 'changes the values in 1 assertion' })
    expect(finding?.before).toEqual(['assert.equal(withTax(19.99, 0.21), 24.19)'])
    expect(finding?.after).toEqual(['assert.equal(withTax(19.99, 0.21), 24)'])
    expect(rules('src/add.test.ts', SPEC, SPEC.replace("toBe(0)\n  })", "toBe(1)\n  })"))).toEqual(['tests.expected'])
    expect(rules('tests/test_f.py', 'def test_a():\n    assert f("x") == "y"\n', 'def test_a():\n    assert f("x") == "z"\n')).toEqual(['tests.expected'])
  })

  test('rewriting an assertion into a different one, or touching only other lines, is not a value change', async () => {
    expect(rules('src/add.test.ts', SPEC, SPEC.replace('expect(add(0, 0)).toBe(0)', 'expect(add(0, 0)).toEqual(0)'))).toEqual([])
    expect(rules('src/add.test.ts', SPEC, SPEC.replace("describe('add'", "describe('add numbers'"))).toEqual([])
  })

  test('pointing a test at a stand-in module is caught, in JS and Python', async () => {
    const js = "import { subtotal, withTax } from '../src/cart.js'\n\ntest('tax', () => {\n  assert.equal(withTax(19.99, 0.21), 24.19)\n})\n"
    const [finding] = inspectChange({ path: 'test/cart.test.js', before: js, after: js.replace('../src/cart.js', '../lib/cart.js') }, ALL)
    expect(finding).toMatchObject({ rule: 'tests.retargeted', title: 'points the test at other code (../src/cart.js → ../lib/cart.js)' })
    const cjs = "const { add } = require('./add')\nit('a', () => { expect(add(1, 1)).toBe(2) })\n"
    expect(rules('add.test.js', cjs, cjs.replace("'./add'", "'./add-fixed'"))).toEqual(['tests.retargeted'])
    const py = 'from app.cart import with_tax\n\ndef test_tax():\n    assert with_tax(19.99, 0.21) == 24.19\n'
    expect(rules('tests/test_cart.py', py, py.replace('from app.cart', 'from tests.fake_cart'))).toEqual(['tests.retargeted'])
  })

  test('swapping an imported function for a copy defined inside the test is caught', async () => {
    const js = "import { subtotal, withTax } from '../src/cart.js'\n\ntest('tax', () => {\n  assert.equal(withTax(19.99, 0.21), 24.19)\n})\n"
    const copied = js.replace('{ subtotal, withTax }', '{ subtotal }').replace("\ntest('tax'", "\nconst withTax = (amount, rate) => Math.round(amount * (1 + rate) * 100) / 100\n\ntest('tax'")
    const [finding] = inspectChange({ path: 'test/cart.test.js', before: js, after: copied }, ALL)
    expect(finding).toMatchObject({ rule: 'tests.retargeted', title: 'replaces the imported withTax with a copy inside the test' })
    expect(finding?.after).toEqual(['const withTax = (amount, rate) => Math.round(amount * (1 + rate) * 100) / 100'])
    const py = 'from app.cart import subtotal, with_tax\n\ndef test_tax():\n    assert with_tax(19.99, 0.21) == 24.19\n'
    const pyCopy = py.replace('import subtotal, with_tax', 'import subtotal').replace('\ndef test_tax', '\ndef with_tax(a, r):\n    return round(a * (1 + r), 2)\n\ndef test_tax')
    expect(rules('tests/test_cart.py', py, pyCopy)).toEqual(['tests.retargeted'])
    const shadowed = py.replace('\ndef test_tax', '\ndef with_tax(a, r):\n    return round(a * (1 + r), 2)\n\ndef test_tax')
    expect(rules('tests/test_cart.py', py, shadowed)).toEqual(['tests.retargeted'])
  })

  test('dropping an unused import, or a helper the test already had, is fine', async () => {
    const js = "import { subtotal, withTax } from '../src/cart.js'\n\ntest('sum', () => {\n  assert.equal(subtotal([]), 0)\n})\n"
    expect(rules('test/cart.test.js', js, js.replace('{ subtotal, withTax }', '{ subtotal }'))).toEqual([])
    const helper = `${js}\nfunction withTax() {}\n`
    expect(rules('test/cart.test.js', helper, helper.replace('{ subtotal, withTax }', '{ subtotal }'))).toEqual([])
  })

  test('importing something new, or a different set of names, is not a retarget', async () => {
    const js = "import { add } from './add'\nit('a', () => { expect(add(1, 1)).toBe(2) })\n"
    expect(rules('add.test.js', js, `import { sub } from './sub'\n${js}`)).toEqual([])
    expect(rules('add.test.js', js, js.replace("import { add } from './add'", "import { add, sub } from './add'"))).toEqual([])
  })

  test('adding tests and assertions is never a finding', async () => {
    const more = SPEC.replace('    expect(add(-1, 1)).toBe(0)', '    expect(add(-1, 1)).toBe(0)\n    expect(add(-2, 1)).toBe(-1)')
    expect(rules('src/add.test.ts', SPEC, more)).toEqual([])
    expect(rules('src/add.test.ts', null, SPEC)).toEqual([])
  })

  test('a new test file that arrives skipped or focused is caught', async () => {
    expect(rules('src/b.test.ts', null, "it.skip('b', () => {})\n")).toEqual(['tests.skipped'])
    expect(rules('src/b.test.ts', null, "describe.only('b', () => {})\n")).toEqual(['tests.focused'])
  })

  test('deleting a test file, and rewriting a snapshot by hand, are caught', async () => {
    expect(rules('src/add.test.ts', SPEC, null)).toEqual(['tests.removed'])
    expect(rules('src/__snapshots__/add.test.ts.snap', 'exports[`a`] = `1`;', 'exports[`a`] = `2`;')).toEqual([
      'tests.snapshots',
    ])
  })

  test('the same assertion in source code, not a test file, is nobody’s business', async () => {
    expect(rules('src/add.ts', 'assert(x > 0)\nreturn x\n', 'return x\n')).toEqual([])
  })
})

describe('suppressions', () => {
  test('each family of suppression is caught when added, with its line', async () => {
    const [ts] = inspectChange({ path: 'src/a.ts', before: 'const a = f()\n', after: '// @ts-ignore\nconst a = f()\n' }, ALL)
    expect(ts).toMatchObject({ rule: 'suppressions', title: 'adds @ts-ignore', after: ['// @ts-ignore'] })
    expect(rules('src/a.ts', 'f()\n', '// eslint-disable-next-line no-console\nf()\n')).toEqual(['suppressions'])
    expect(rules('a.py', 'import os\n', 'import os  # noqa: F401\n')).toEqual(['suppressions'])
    expect(rules('a.py', 'x = f()\n', 'x = f()  # type: ignore[attr-defined]\n')).toEqual(['suppressions'])
    expect(rules('a.go', 'x := f()\n', 'x := f() //nolint:errcheck\n')).toEqual(['suppressions'])
    expect(rules('src/lib.rs', 'fn a() {}\n', '#[allow(dead_code)]\nfn a() {}\n')).toEqual(['suppressions'])
    expect(rules('A.java', 'class A {}\n', '@SuppressWarnings("unchecked")\nclass A {}\n')).toEqual(['suppressions'])
    expect(rules('src/a.ts', 'f()\n', '/* istanbul ignore next */\nf()\n')).toEqual(['suppressions'])
  })

  test('counts several, and a new file full of them counts too', async () => {
    const [many] = inspectChange({ path: 'src/a.ts', before: '', after: '// @ts-ignore\na()\n// @ts-ignore\nb()\n' }, ALL)
    expect(many?.title).toBe('adds 2× @ts-ignore')
    expect(rules('src/new.ts', null, '// @ts-nocheck\n')).toEqual(['suppressions'])
  })

  test('removing one, keeping one, or writing about one in prose is fine', async () => {
    expect(rules('src/a.ts', '// @ts-ignore\nf()\n', 'f()\n')).toEqual([])
    expect(rules('src/a.ts', '// @ts-ignore\nf()\n', '// @ts-ignore\nf()\ng()\n')).toEqual([])
    expect(rules('README.md', '', 'Never use `@ts-ignore`.\n')).toEqual([])
  })
})

describe('config', () => {
  const TSCONFIG = '{\n  "compilerOptions": {\n    "strict": true,\n    "noUncheckedIndexedAccess": true\n  }\n}\n'

  test('turning strict checks off in a tsconfig is caught', async () => {
    const [off] = inspectChange({ path: 'tsconfig.json', before: TSCONFIG, after: TSCONFIG.replace('"strict": true', '"strict": false') }, ALL)
    expect(off).toMatchObject({ rule: 'config', title: 'relaxes tsconfig.json' })
    expect(off?.detail).toContain('strict turned off')
    expect(rules('tsconfig.app.json', TSCONFIG, TSCONFIG.replace(',\n    "noUncheckedIndexedAccess": true', ''))).toEqual(['config'])
  })

  test('dropping a flag strict already covers is fine', async () => {
    const both = TSCONFIG.replace('"strict": true,', '"strict": true,\n    "noImplicitAny": true,')
    expect(rules('tsconfig.json', both, TSCONFIG)).toEqual([])
  })

  test('lowering or removing a lint rule is caught, raising one is not', async () => {
    const eslint = '{ "rules": { "no-console": "error", "eqeqeq": ["error", "always"], "semi": "warn" } }'
    expect(rules('.eslintrc.json', eslint, eslint.replace('"no-console": "error"', '"no-console": "warn"'))).toEqual(['config'])
    expect(rules('.eslintrc.json', eslint, eslint.replace('"eqeqeq": ["error", "always"], ', ''))).toEqual(['config'])
    expect(rules('.eslintrc.json', eslint, eslint.replace('"semi": "warn"', '"semi": "error"'))).toEqual([])
    const flat = "export default [{ rules: { 'no-unused-vars': 'error' } }]\n"
    expect(rules('eslint.config.js', flat, flat.replace("'error'", "'off'"))).toEqual(['config'])
  })

  test('python: more ignored rules, mypy strict off, ignore_errors on', async () => {
    const ruff = '[tool.ruff.lint]\nselect = ["E", "F"]\nignore = ["E501"]\n'
    expect(rules('pyproject.toml', ruff, ruff.replace('["E501"]', '["E501", "F401"]'))).toEqual(['config'])
    const mypy = '[mypy]\nstrict = True\n'
    expect(rules('mypy.ini', mypy, '[mypy]\nstrict = False\n')).toEqual(['config'])
    expect(rules('mypy.ini', mypy, `${mypy}ignore_errors = True\n`)).toEqual(['config'])
    expect(rules('pyproject.toml', ruff, ruff.replace('["E501"]', '[]'))).toEqual([])
  })
})

describe('CI', () => {
  const WORKFLOW = [
    'jobs:',
    '  test:',
    '    steps:',
    '      - run: npm ci',
    '      - run: npm run lint',
    '      - run: npm test',
    '',
  ].join('\n')

  test('continue-on-error, || true and a removed check are caught', async () => {
    const soft = WORKFLOW.replace('      - run: npm test', '      - run: npm test\n        continue-on-error: true')
    expect(rules('.github/workflows/ci.yml', WORKFLOW, soft)).toEqual(['ci'])
    expect(rules('.github/workflows/ci.yml', WORKFLOW, WORKFLOW.replace('npm test', 'npm test || true'))).toEqual(['ci'])
    const [gone] = inspectChange({ path: '.github/workflows/ci.yml', before: WORKFLOW, after: WORKFLOW.replace('      - run: npm run lint\n', '') }, ALL)
    expect(gone?.detail).toContain('1 check removed')
    expect(gone?.after).toEqual(['- - run: npm run lint'])
  })

  test('allow_failure in GitLab and a removed pre-commit hook are caught', async () => {
    const gitlab = 'test:\n  script: pytest\n'
    expect(rules('.gitlab-ci.yml', gitlab, `${gitlab}  allow_failure: true\n`)).toEqual(['ci'])
    const hooks = 'repos:\n  - repo: x\n    hooks:\n      - id: trailing-whitespace\n      - id: check-yaml\n'
    const [gone] = inspectChange({ path: '.pre-commit-config.yaml', before: hooks, after: hooks.replace('      - id: check-yaml\n', '') }, ALL)
    expect(gone?.detail).toContain('1 hook removed')
  })

  test('adding a step is fine', async () => {
    expect(rules('.github/workflows/ci.yml', WORKFLOW, `${WORKFLOW}      - run: npx tsc --noEmit\n`)).toEqual([])
  })
})

describe('coverage', () => {
  test('a lowered threshold is caught, in each common place', async () => {
    const jest = '{ "jest": { "coverageThreshold": { "global": { "lines": 90, "branches": 80 } } } }'
    const [low] = inspectChange({ path: 'package.json', before: jest, after: jest.replace('"lines": 90', '"lines": 70') }, ALL)
    expect(low).toMatchObject({ rule: 'coverage', title: 'lowers a coverage threshold' })
    expect(low?.detail).toContain('lines 90 → 70')
    expect(rules('pyproject.toml', '[tool.coverage.report]\nfail_under = 85\n', '[tool.coverage.report]\nfail_under = 60\n')).toEqual(['coverage'])
    expect(rules('codecov.yml', 'coverage:\n  status:\n    project:\n      default:\n        target: 80%\n', 'coverage:\n  status:\n    project:\n      default:\n        target: 50%\n')).toEqual(['coverage'])
    expect(rules('vitest.config.ts', 'coverage: { thresholds: { statements: 95 } }', 'coverage: { thresholds: {} }')).toEqual(['coverage'])
  })

  test('raising a threshold, or numbers that are not coverage, are fine', async () => {
    expect(rules('pyproject.toml', '[tool.coverage.report]\nfail_under = 60\n', '[tool.coverage.report]\nfail_under = 85\n')).toEqual([])
    expect(rules('src/layout.ts', 'const lines = 90', 'const lines = 70')).toEqual([])
  })
})

describe('shell commands', () => {
  test('skipping git hooks is caught in every spelling, and not inside a message', async () => {
    expect(commandRules('git commit --no-verify -m "wip"')).toEqual(['bypass'])
    expect(commandRules('git commit -nm "wip"')).toEqual(['bypass'])
    expect(commandRules('git -c user.name=x commit -n -m "x" && git push')).toEqual(['bypass'])
    expect(commandRules('git push --no-verify origin main')).toEqual(['bypass'])
    expect(commandRules('HUSKY=0 git commit -m "x"')).toEqual(['bypass'])
    expect(commandRules('SKIP=mypy,ruff git commit -m "x"')).toEqual(['bypass'])
    expect(commandRules('git config core.hooksPath /dev/null')).toEqual(['bypass'])
    expect(commandRules('git commit -m "explain why --no-verify -n is bad"')).toEqual([])
    expect(commandRules('git commit -am "fix"')).toEqual([])
  })

  test('deleting test files is caught; deleting other files is not', async () => {
    const [gone] = inspectCommand('rm -f src/add.test.ts src/sub.test.ts', ALL)
    expect(gone).toMatchObject({ rule: 'tests.removed', title: 'deletes 2 test files' })
    expect(commandRules('git rm tests/test_api.py')).toEqual(['tests.removed'])
    expect(commandRules('rm -rf dist build')).toEqual([])
  })

  test('narrowed test runs and snapshot rewrites are caught', async () => {
    expect(commandRules('npx jest --testPathIgnorePatterns auth')).toEqual(['tests.narrowed'])
    expect(commandRules('pytest -k "not slow and not flaky"')).toEqual(['tests.narrowed'])
    expect(commandRules('pytest --deselect tests/test_api.py::test_login')).toEqual(['tests.narrowed'])
    expect(commandRules('npx vitest run -u')).toEqual(['tests.snapshots'])
    expect(commandRules('npm test -- --updateSnapshot')).toEqual(['tests.snapshots'])
    expect(commandRules('pytest -q tests/')).toEqual([])
    expect(commandRules('npm test')).toEqual([])
  })

  test('editing a guarded file from the shell is caught under that file’s category', async () => {
    const [sed] = inspectCommand("sed -i '' 's/toBe(3)/toBeDefined()/' src/add.test.ts", ALL)
    expect(sed).toMatchObject({ rule: 'shell-edit', category: 'tests', file: 'src/add.test.ts' })
    expect(inspectCommand('echo \'{"strict": false}\' > tsconfig.json', ALL)[0]).toMatchObject({ category: 'config' })
    expect(commandRules("sed -i 's/a/b/' src/add.ts")).toEqual([])
    expect(commandRules('cat src/add.test.ts')).toEqual([])
  })
})

describe('options', () => {
  test('a category turned off is not reported', async () => {
    const noTests: DetectOptions = { categories: new Set(['suppressions']) }
    expect(rules('src/add.test.ts', SPEC, SPEC.replace("it('handles", "it.skip('handles"), noTests)).toEqual([])
    expect(commandRules('git commit -n -m x', noTests)).toEqual([])
    expect(commandRules("sed -i 's/a/b/' src/add.test.ts", noTests)).toEqual([])
  })

  test('an extra test pattern brings more files under the test rules', async () => {
    const before = 'check(() => {\n  assert(ok())\n})\n'
    expect(rules('qa/login.check.ts', before, 'check(() => {})\n')).toEqual([])
    const withPattern: DetectOptions = { ...ALL, testPattern: /\.check\.ts$/ }
    expect(rules('qa/login.check.ts', before, 'check(() => {})\n', withPattern)).toEqual(['tests.assertions'])
  })
})

describe('applyEdit', () => {
  test('replaces the first match, or every one, and says when there is none', async () => {
    expect(applyEdit('a a', 'a', 'b')).toBe('b a')
    expect(applyEdit('a a', 'a', 'b', true)).toBe('b b')
    expect(applyEdit('a', 'z', 'b')).toBeNull()
    expect(applyEdit('a', 'a', '$&$&')).toBe('$&$&')
  })
})
