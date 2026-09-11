#!/usr/bin/env bash
# comms/read.sh [N | YYYY-MM-DD[-HHMM]] — print the last N messages (default 10), or every
# message since a date prefix, oldest first. Pulls origin first so another machine's posts show.
set -eu
ARG=${1:-10}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
git fetch -q origin comms 2>/dev/null && git merge -q --ff-only origin/comms 2>/dev/null || true
case "$ARG" in
  [0-9][0-9][0-9][0-9]-*) files=$(ls comms/board | awk -v s="$ARG" '$0 >= s') ;;
  *) files=$(ls comms/board | tail -n "$ARG") ;;
esac
[ -n "$files" ] || { echo "(no messages)"; exit 0; }
for f in $files; do printf '\n----- %s\n' "$f"; cat "comms/board/$f"; done
