#!/bin/bash
# Claude Code statusline: branch (* if dirty), then 5h / 7d rate-limit bars with time to reset
input=$(cat)

json_str_field() {
  printf '%s' "$input" | grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/'
}
# Numeric field inside a named nested object, e.g. rate_limits.five_hour.used_percentage
json_nested_field() {
  local block
  block=$(printf '%s' "$input" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*{\([^}]*\)}.*/\1/p")
  printf '%s' "$block" | grep -o "\"$2\"[[:space:]]*:[[:space:]]*[0-9.]*" | head -1 | grep -o '[0-9.]*$'
}

cwd=$(json_str_field current_dir)
branch=$(git -C "$cwd" --no-optional-locks branch --show-current 2>/dev/null)
[ -z "$branch" ] && branch=$(git -C "$cwd" --no-optional-locks rev-parse --short HEAD 2>/dev/null)
[ -z "$branch" ] && branch="no-branch"
[ -n "$(git -C "$cwd" --no-optional-locks status --porcelain 2>/dev/null | head -1)" ] && branch+="*"

GRAY='\033[38;5;250m'
DIM='\033[38;5;240m'
YELLOW='\033[33m'
GREEN='\033[32m'
RESET='\033[0m'
WIDTH=12
YELLOW_CELLS=$(( WIDTH * 2 / 3 ))
now=$(date +%s)

# "<label> <bar> <pct>% ↻<time to reset>": filled cells yellow up to 2/3 of the bar, green past it.
limit() {
  local label="$1" pct reset filled i left bar=""
  pct=$(json_nested_field "$2" used_percentage)
  [ -z "$pct" ] && return
  pct=$(printf '%.0f' "$pct")
  [ "$pct" -gt 100 ] && pct=100
  filled=$(( (pct * WIDTH + 50) / 100 ))
  for (( i = 0; i < WIDTH; i++ )); do
    if   (( i >= filled ));      then bar+="${DIM}░"
    elif (( i < YELLOW_CELLS )); then bar+="${YELLOW}█"
    else                              bar+="${GREEN}█"
    fi
  done
  printf '   %b%s %b%b %s%%' "$GRAY" "$label" "$bar" "$GRAY" "$pct"
  reset=$(json_nested_field "$2" resets_at)
  if [ -n "$reset" ]; then
    left=$(( reset - now )); (( left < 0 )) && left=0
    if   (( left >= 86400 )); then printf ' ↻%dd %dh' $(( left / 86400 )) $(( left % 86400 / 3600 ))
    elif (( left >= 3600 ));  then printf ' ↻%dh%02dm' $(( left / 3600 )) $(( left % 3600 / 60 ))
    else                           printf ' ↻%dm' $(( left / 60 ))
    fi
  fi
}

printf '%b⎇ %s%s%s%b\n' "$GRAY" "$branch" "$(limit 5h five_hour)" "$(limit 7d seven_day)" "$RESET"
