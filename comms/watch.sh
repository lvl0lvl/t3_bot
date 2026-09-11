#!/usr/bin/env bash
# comms/watch.sh <track> [session_id] — emit each new board message addressed to <track>
# (or all) as it lands, forever. Run it under Monitor(persistent: true); every message becomes
# a notification in your chat. With a session_id, emitted messages are marked seen so the
# Stop hook does not re-deliver them.
set -u
[ $# -ge 1 ] || { echo "usage: watch.sh <track> [session_id]" >&2; exit 2; }
TRACK=$1; SID=${2:-}
. "$(dirname "$0")/lib.sh"
cd "$ROOT"
last=$(ls "$BOARD" | tail -1)
i=0
while true; do
  i=$((i + 1))
  # every ~30s pull off-machine posts; local posts are visible instantly
  [ $((i % 15)) -eq 0 ] && { git fetch -q origin comms 2>/dev/null && git merge -q --ff-only origin/comms 2>/dev/null || true; }
  for f in $(ls "$BOARD" | awk -v s="$last" '$0 > s'); do
    last=$f
    if addressed_to "$TRACK" "$BOARD/$f"; then
      printf 'BOARD MESSAGE %s\n' "$f"; cat "$BOARD/$f"; echo
      [ -n "$SID" ] && mark_seen "$SID" "$f"
    fi
  done
  sleep 2
done
