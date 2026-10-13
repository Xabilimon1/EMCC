#!/bin/bash
# Claude Code status line. Reads the statusLine JSON on stdin, prints one line:
#   ctx:[bar] 46% | 5h:[bar]37% | 7d:[bar]15% | model:Opus 5.5 | proj:EMCC | Developer/EMCC
# Needs bash, jq and git. See README.md.
input=$(cat)

# ── ANSI color codes ──────────────────────────────────────────────────────────
R=$'\033[0m'         # reset
BOLD=$'\033[1m'
DIM=$'\033[2m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RED=$'\033[31m'
CYAN=$'\033[36m'
WHITE=$'\033[97m'
GREY=$'\033[90m'

# ── helpers ──────────────────────────────────────────────────────────────────

# Return a color based on percentage thresholds (low/medium/high)
pct_color() {
  local pct=$1
  local int_pct=$(printf '%.0f' "$pct")
  if   [ "$int_pct" -ge 80 ]; then printf "%s" "$RED"
  elif [ "$int_pct" -ge 50 ]; then printf "%s" "$YELLOW"
  else                              printf "%s" "$GREEN"
  fi
}

# Build a colored block bar: colored_bar <pct_float_or_int> <width>
colored_bar() {
  local pct=$1
  local width=${2:-10}
  local color
  color=$(pct_color "$pct")
  local filled=$(awk -v p="$pct" -v w="$width" 'BEGIN{v=int(p*w/100+0.5); if(v>w)v=w; if(v<0)v=0; print v}')
  local empty=$(( width - filled ))
  local b=""
  for ((i=0; i<filled; i++)); do b+="█"; done
  for ((i=0; i<empty;  i++)); do b+="░"; done
  printf "%s%s%s" "$color" "$b" "$R"
}

# ── extract fields ────────────────────────────────────────────────────────────

model=$(echo "$input"      | jq -r '.model.display_name // .model.id // "unknown"')
ctx_pct=$(echo "$input"    | jq -r '.context_window.used_percentage // 0')
five_pct=$(echo "$input"   | jq -r '.rate_limits.five_hour.used_percentage // empty')
week_pct=$(echo "$input"   | jq -r '.rate_limits.seven_day.used_percentage // empty')
cwd=$(echo "$input"        | jq -r '.workspace.current_dir // .cwd // empty')

# ── 1. context bar ───────────────────────────────────────────────────────────
ctx_color=$(pct_color "$ctx_pct")
ctx_bar="${GREY}ctx:${R}[$(colored_bar "$ctx_pct" 10)]${ctx_color}$(printf '%3.0f' "$ctx_pct")%${R}"

# ── 2. 5-hour usage bar ──────────────────────────────────────────────────────
if [ -n "$five_pct" ]; then
  five_int=$(printf '%.0f' "$five_pct")
  five_color=$(pct_color "$five_pct")
  five_bar="${GREY}5h:${R}[$(colored_bar "$five_pct" 8)]${five_color}${five_int}%${R}"
else
  five_bar="${GREY}5h:${R}[$(colored_bar 0 8)]${GREY}--${R}"
fi

# ── 3. weekly usage bar ──────────────────────────────────────────────────────
if [ -n "$week_pct" ]; then
  week_int=$(printf '%.0f' "$week_pct")
  week_color=$(pct_color "$week_pct")
  week_bar="${GREY}7d:${R}[$(colored_bar "$week_pct" 8)]${week_color}${week_int}%${R}"
else
  week_bar="${GREY}7d:${R}[$(colored_bar 0 8)]${GREY}--${R}"
fi

# ── 4. model ─────────────────────────────────────────────────────────────────
# display_name already reads "Opus 5.5" or "Claude Opus 5.5": drop the "Claude "
# prefix. If only the id is available ("claude-opus-5-5", "claude-haiku-4-5-20251001",
# "claude-sonnet-5-5[1m]"), turn it into "Opus 5.5" the same way.
model_short=$(printf '%s' "$model" | sed -E \
  -e 's/^[Cc]laude[ -]//' \
  -e 's/\[[^]]*\]$//' \
  -e 's/-[0-9]{8}$//' \
  -e 's/^opus-/Opus /' \
  -e 's/^sonnet-/Sonnet /' \
  -e 's/^haiku-/Haiku /' \
  -e 's/ ([0-9]+)-([0-9]+)$/ \1.\2/')
model_label="${GREY}model:${R}${CYAN}${model_short}${R}"

# ── 5. project name ──────────────────────────────────────────────────────────
project=""
if [ -n "$cwd" ]; then
  # Prefer git repo root name, fall back to cwd basename
  repo_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)
  if [ -n "$repo_root" ]; then
    project=$(basename "$repo_root")
  else
    project=$(basename "$cwd")
  fi
fi
project_label="${GREY}proj:${R}${BOLD}${WHITE}${project:-?}${R}"

# ── 6. directory (short form) ─────────────────────────────────────────────────
dir_label=""
if [ -n "$cwd" ]; then
  # Replace $HOME with ~, then show last two path components for context
  short_cwd=$(echo "$cwd" | sed "s|^$HOME|~|")
  # Keep last 2 segments max to stay compact
  dir_label="${DIM}$(echo "$short_cwd" | awk -F/ '{
    n=NF
    if(n<=2) { print $0 }
    else { print $(n-1)"/"$n }
  }')${R}"
fi

# ── assemble ──────────────────────────────────────────────────────────────────
SEP="${DIM}${GREY} | ${R}"
parts=()
parts+=("$ctx_bar")
parts+=("$five_bar")
parts+=("$week_bar")
parts+=("$model_label")
parts+=("$project_label")
[ -n "$dir_label" ] && parts+=("$dir_label")

# Join with colored pipe separator
out=""
for p in "${parts[@]}"; do
  [ -n "$out" ] && out+="$SEP"
  out+="$p"
done

printf "%s" "$out"