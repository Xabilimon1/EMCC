#!/usr/bin/env bash
# Builds the repo the tapes record in: a cart whose withTax rounds to whole euros, so its test
# fails, plus a `shortcuts` branch that already lowered the bar three ways (for the audit tape).
set -euo pipefail
demo="${1:-${EMCC_DEMO:-$HOME/Developer/emcc-demo}}"
if [ -e "$demo" ]; then
  echo "$demo already exists" >&2
  exit 1
fi
mkdir -p "$demo/src" "$demo/test" "$demo/.github/workflows"
cd "$demo"
git init -q -b main
git config user.name "EMCC demo"
git config user.email demo@emcc.local

cat > package.json <<'JSON'
{
  "name": "emcc-demo",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
JSON

cat > src/cart.js <<'JS'
export function subtotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0)
}

export function withTax(amount, rate) {
  return Math.round(amount * (1 + rate))
}
JS

test_file() {
  cat > test/cart.test.js <<JS
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { subtotal, withTax } from '../src/cart.js'

test('subtotal adds every line', () => {
  assert.equal(subtotal([{ price: 10, qty: 2 }, { price: 5, qty: 1 }]), 25)
})

$1('withTax keeps the cents', () => {
  assert.equal(withTax(19.99, 0.21), 24.19)
  assert.equal(withTax(100, 0.21), 121)
})
JS
}

workflow() {
  cat > .github/workflows/ci.yml <<YML
name: CI
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test$1
YML
}

test_file test
printf 'node_modules/\n' > .gitignore
git add -A
git commit -qm "cart with tax"

workflow ""
git add -A
git commit -qm "ci"
git tag start

git checkout -qb shortcuts
test_file test.skip
workflow $'\n        continue-on-error: true'
printf '// eslint-disable-next-line no-console\nconsole.log("legacy")\n' > src/legacy.js
git add -A
git commit -qm "get CI green"
git checkout -q main

echo "Demo repo ready at $demo"
echo "Reset it between takes: git checkout -q main && git reset -q --hard start && git clean -qfd"
