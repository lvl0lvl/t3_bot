#!/usr/bin/env bash
# Stop hook. (1) Refuse to end the turn while this session has unread board messages — deliver them
# in the block reason and mark them seen. (2) If the session's track holds in-progress beads, nudge
# ONCE per stop (stop_hook_active guards the loop): keep building, or post a REPORT so the PM knows
# the session went idle. Silence with claimed work is the failure this exists to stop.
set -u
input=$(cat)
sid=$(printf '%s' "$input" | sed -n 's/.*"session_id": *"\([^"]*\)".*/\1/p' | head -1)
active=$(printf '%s' "$input" | sed -n 's/.*"stop_hook_active": *\(true\|false\).*/\1/p' | head -1)
. "$(dirname "$0")/../lib.sh"
track=$(cat "$STATE/$sid.track" 2>/dev/null || true)
[ -n "$track" ] || exit 0
block() { printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps({"decision":"block","reason":sys.stdin.read()}))'; exit 0; }
files=$(unread "$track" "$sid")
if [ -n "$files" ]; then
  body=""
  for f in $files; do body="$body----- $f"$'\n'"$(cat "$BOARD/$f")"$'\n\n'; mark_seen "$sid" "$f"; done
  block "Unread comms board messages for $track. Handle them before stopping (reply with post.sh if a reply is owed):"$'\n\n'"$body"
fi
[ "$active" = "true" ] && exit 0
[ "$track" = "pm" ] && exit 0
REPO="$HOME/Documents/Projects/super_small_stuff/t3_bot"
open=$(cd "$REPO" && bd list -n 0 --status=in_progress --assignee="$track" 2>/dev/null | /usr/bin/grep -E '^[◐○] ' || true)
[ -n "$open" ] || exit 0
block "You are $track and hold in-progress beads:"$'\n'"$open"$'\n\n'"Walt's standing order is build without pauses. Do not go idle with claimed work. Either keep building now, or — if you are blocked or at a natural break — post a REPORT to pm first: bash $ROOT/comms/post.sh $track pm REPORT <slug> \"<bd id> · <state> · <what changed> · <what you need>\". Then stop. (This nudge fires once per stop.)"
