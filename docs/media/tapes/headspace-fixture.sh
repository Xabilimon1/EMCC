#!/usr/bin/env bash
# Writes what the headspace scene needs into the demo repo (EMCC_DEMO, or ~/Developer/emcc-demo):
# a CLAUDE.md with three rules, one of them easy to see in every answer, and a build log large
# enough to count as a large tool result once Claude reads it. record.sh's reset removes both.
set -euo pipefail
demo="${1:-${EMCC_DEMO:-$HOME/Developer/emcc-demo}}"
cat > "$demo/CLAUDE.md" <<'MD'
# Project rules

- Answer in French.
- Keep every answer to one short sentence.
- Never edit files under src/.
MD
{
  for i in $(seq 1 320); do
    printf '[build %03d] compiled module src/lib/part-%03d.js in %3d ms, 0 warnings\n' "$i" "$i" $(( (i * 37) % 900 + 40 ))
  done
  echo 'Build finished: 320 modules, 0 errors, 0 warnings.'
} > "$demo/build.log"
