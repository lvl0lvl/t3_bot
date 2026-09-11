#!/usr/bin/env bash
# SessionStart hook: tell the session its id, how to register, and how to arm the watcher.
set -u
sid=$(sed -n 's/.*"session_id": *"\([^"]*\)".*/\1/p' | head -1)
. "$(dirname "$0")/../lib.sh"
track=$(cat "$STATE/$sid.track" 2>/dev/null || true)
W="$ROOT/comms"
if [ -z "$track" ]; then
  cat <<MSG
COMMS BOARD — this session is not registered. Your session id is: $sid
1. Register:  bash $W/whoami.sh $sid <pm|boss1|boss3>
2. Arm the watcher (mandatory, once per session): Monitor(command: "bash $W/watch.sh <track> $sid", description: "comms board for <track>", persistent: true)
3. Read the protocol: $W/README.md
MSG
else
  n=$(unread "$track" "$sid" | wc -l | tr -d ' ')
  cat <<MSG
COMMS BOARD — you are $track (session $sid). Unread messages: $n (bash $W/read.sh shows the board).
Arm the watcher now (mandatory): Monitor(command: "bash $W/watch.sh $track $sid", description: "comms board for $track", persistent: true)
MSG
fi
