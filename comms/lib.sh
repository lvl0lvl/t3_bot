# comms/lib.sh — shared by watch.sh and the hooks. Source it.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOARD="$ROOT/comms/board"
STATE="$ROOT/comms/.state"
mkdir -p "$STATE"
# addressed_to <track> <file>: true if the message is for this track and not from it
addressed_to() {
  local to from
  to=$(sed -n '2s/^TO: //p' "$2"); from=$(sed -n '1s/^FROM: //p' "$2")
  [ "$from" != "$1" ] && { [ "$to" = "$1" ] || [ "$to" = all ]; }
}
# unread <track> <session_id>: print filenames addressed to track, newer than the session's
# registration, not yet marked seen for this session
unread() {
  local track=$1 sid=$2 since seen f
  since=$(cat "$STATE/$sid.since" 2>/dev/null || echo "0000")
  seen="$STATE/$sid.seen"; touch "$seen"
  for f in $(ls "$BOARD" | awk -v s="$since" '$0 > s'); do
    /usr/bin/grep -qxF "$f" "$seen" && continue
    addressed_to "$track" "$BOARD/$f" && echo "$f"
  done
}
mark_seen() { echo "$2" >> "$STATE/$1.seen"; }
