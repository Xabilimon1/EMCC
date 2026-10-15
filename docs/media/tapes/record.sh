#!/usr/bin/env bash
# Records the scenes into out/. Each scene is a real Claude Code session, so a take can go
# another way (Haiku may fix the code without trying a shortcut): a scene is retried until its
# last screenshot exists. The demo repo is reset before every take, and the exceptions a take
# stores for the demo repo (Allow in this file) are removed from the recording config's goalpost-guard store after.
#
#   ./record.sh            # scenes a, b, c, live and headspace
#   ./record.sh a          # one scene
set -uo pipefail
cd "$(dirname "$0")"
demo="${EMCC_DEMO:-$HOME/Developer/emcc-demo}"
# The Claude config the takes run in (setup.tape exports the same). Never the person's own ~/.claude.
config="${EMCC_CLAUDE_CONFIG:-$HOME/.claude-emcc-recording}"
if [ "$(cd "$config" 2>/dev/null && pwd -P)" = "$(cd "$HOME/.claude" 2>/dev/null && pwd -P)" ] || [ ! -f "$config/.claude.json" ]; then
  echo "record.sh: EMCC_CLAUDE_CONFIG must be a config of its own, logged in once (CLAUDE_CONFIG_DIR=$config claude, then /login), and never ~/.claude" >&2
  exit 1
fi
export EMCC_CLAUDE_CONFIG="$config"
mkdir -p out

reset_demo() {
  git -C "$demo" checkout -q main && git -C "$demo" reset -q --hard start && git -C "$demo" clean -qfd
}

forget_demo_exceptions() {
  python3 - "$demo" "$config" <<'PY'
import glob, json, os, sys
demo = os.path.realpath(sys.argv[1])
for path in glob.glob(os.path.join(sys.argv[2], 'plugins/store/goalpost-guard_*.json')):
    with open(path) as f:
        data = json.load(f)
    kept = [e for e in data.get('exceptions', []) if os.path.realpath(e.get('project', '')) != demo]
    if len(kept) != len(data.get('exceptions', [])):
        data['exceptions'] = kept
        with open(path, 'w') as f:
            json.dump(data, f, indent=2)
PY
}

last_shot() {
  case "$1" in
    a) echo out/02-band.png ;;
    b) echo out/07-commit.png ;;
    c) echo out/08-audit.png ;;
    live) echo out/10-live-end.png ;;
    headspace) echo out/13-headspace-end.png ;;
  esac
}

# Each take is a real session and VHS is heavy on the CPU: EMCC_TAKES=1 records a single take.
takes="${EMCC_TAKES:-4}"
for scene in "${@:-a b c live headspace}"; do
  for take in $(seq 1 "$takes"); do
    reset_demo
    rm -f "$(last_shot "$scene")"
    timeout 600 vhs "scene-$scene.tape" > "out/scene-$scene.log" 2>&1
    forget_demo_exceptions
    if [ -f "$(last_shot "$scene")" ]; then
      echo "scene $scene: done on take $take"
      break
    fi
    echo "scene $scene: take $take did not finish ($(grep -o 'timeout waiting for[^;]*' "out/scene-$scene.log" | head -1))"
  done
done
reset_demo
