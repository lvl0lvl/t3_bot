#!/usr/bin/env bash
# Stop hook: refuse to end the turn while this session has unread board messages.
# Delivers them in the block reason and marks them seen, so the next Stop passes.
set -u
sid=$(sed -n 's/.*"session_id": *"\([^"]*\)".*/\1/p' | head -1)
. "$(dirname "$0")/../lib.sh"
track=$(cat "$STATE/$sid.track" 2>/dev/null || true)
[ -n "$track" ] || exit 0
files=$(unread "$track" "$sid")
[ -n "$files" ] || exit 0
body=""
for f in $files; do
  body="$body----- $f"$'\n'"$(cat "$BOARD/$f")"$'\n\n'
  mark_seen "$sid" "$f"
done
reason="Unread comms board messages for $track. Handle them before stopping (reply with post.sh if a reply is owed):"$'\n\n'"$body"
printf '%s' "$reason" | python3 -c 'import json,sys; print(json.dumps({"decision":"block","reason":sys.stdin.read()}))'
