#!/usr/bin/env bash
# comms/post.sh — post one message to the board and push it.
# usage: post.sh <track> <to> <TYPE> <slug> "<subject>" < body
set -eu
[ $# -eq 5 ] || { echo "usage: post.sh <track> <to> <TYPE> <slug> \"<subject>\" < body" >&2; exit 2; }
FROM=$1; TO=$2; TYPE=$3; SLUG=$4; RE=$5
TRACKS='pm|boss1|boss3'
case "$FROM" in pm|boss1|boss3|owner) ;; *) echo "track must be $TRACKS|owner" >&2; exit 2;; esac
case "$TO" in pm|boss1|boss3|all|owner) ;; *) echo "to must be a track, all or owner" >&2; exit 2;; esac
case "$TYPE" in ASSIGN|REPORT|ASK|ANSWER|CLAIM|NOTICE|LANDED|INCIDENT|RULING-RELAY) ;; *) echo "TYPE must be ASSIGN|REPORT|ASK|ANSWER|CLAIM|NOTICE|LANDED|INCIDENT|RULING-RELAY" >&2; exit 2;; esac
case "$SLUG" in *[!a-z0-9-]*|"") echo "slug: lowercase letters, digits and dashes" >&2; exit 2;; esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ "$(git branch --show-current)" = comms ] || { echo "this worktree is not on the comms branch" >&2; exit 2; }
n=$(ls comms/board 2>/dev/null | /usr/bin/grep -c -- "-$FROM-" || true)
seq=$(printf '%03d' $((n + 1)))
f="comms/board/$(date +%Y-%m-%d-%H%M%S)-$FROM-$seq-$SLUG.md"
{ printf 'FROM: %s\nTO: %s\nTYPE: %s\nRE: %s\nAT: %s\n\n' "$FROM" "$TO" "$TYPE" "$RE" "$(date '+%Y-%m-%d %H:%M %Z')"; cat; } > "$f"
git add -- "$f"
git commit -q -m "board: $FROM $seq $TYPE $SLUG" -- "$f"
echo "$f"
# Local delivery is the commit (every watcher reads this worktree). The push is the off-machine copy and must
# never block or fail a post: a report that hangs on the network is a report nobody receives.
( git push -q origin comms 2>/dev/null || { git pull -q --rebase origin comms 2>/dev/null && git push -q origin comms 2>/dev/null; } ) >/dev/null 2>&1 </dev/null &
disown 2>/dev/null || true
