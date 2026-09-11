#!/usr/bin/env bash
# comms/whoami.sh <session_id> <track> — register this session as a track. The SessionStart
# hook prints your session id. Messages older than registration are never "unread".
set -eu
[ $# -eq 2 ] || { echo "usage: whoami.sh <session_id> <track>" >&2; exit 2; }
case "$2" in pm|boss1|boss3) ;; *) echo "track must be pm|boss1|boss3" >&2; exit 2;; esac
. "$(dirname "$0")/lib.sh"
echo "$2" > "$STATE/$1.track"
[ -f "$STATE/$1.since" ] || date +%Y-%m-%d-%H%M%S > "$STATE/$1.since"
echo "registered session $1 as $2"
