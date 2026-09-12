#!/usr/bin/env bash
# comms/watchdog.sh — PM's stall detector. Run under Monitor(persistent: true). Wall-clock based, so it
# survives system sleep (a `sleep 900` started before a suspend does not fire on wake).
# Every 30s: for each senior track, measure minutes since its last board post OR last push to origin.
# If a track holds an in-progress bead and is stale past STALE_MIN, post a wake ASSIGN from pm
# automatically and emit a line. Every BEAT_MIN emit a heartbeat; prefix ACTION REQUIRED when any
# track is stale so the PM cannot mistake it for "all quiet".
set -u
. "$(dirname "$0")/lib.sh"
REPO="$HOME/Documents/Projects/super_small_stuff/t3_bot"
TRACKS="boss1 boss3"; STALE_MIN=${STALE_MIN:-30}; BEAT_MIN=${BEAT_MIN:-15}; REWAKE_MIN=${REWAKE_MIN:-30}
now() { date +%s; }
last_post_epoch() { f=$(ls -t "$BOARD" | /usr/bin/grep -- "-$1-" | head -1); [ -n "$f" ] && stat -f %m "$BOARD/$f" || echo 0; }
last_push_epoch() { git -C "$REPO" for-each-ref --sort=-committerdate --format='%(committerdate:unix)' "refs/remotes/origin/$1/*" 2>/dev/null | head -1; }
has_claim() { (cd "$REPO" && bd list -n 0 --status=in_progress --assignee="$1" 2>/dev/null | /usr/bin/grep -qE '^[◐○] '); }
declare -A woke; last_beat=$(now); last_tick=$(now); last_fetch=0
while true; do
  t=$(now)
  if [ $((t - last_tick)) -gt 180 ]; then echo "WATCHDOG RESUMED after $(( (t - last_tick) / 60 ))m gap (system sleep?) — rechecking now"; fi
  last_tick=$t
  if [ $((t - last_fetch)) -ge 300 ]; then perl -e 'alarm 25; exec @ARGV' git -C "$REPO" fetch -q origin 2>/dev/null; last_fetch=$t; fi
  report=""; action=0
  for tr in $TRACKS; do
    p=$(last_post_epoch "$tr"); u=$(last_push_epoch "$tr"); [ -z "$u" ] && u=0
    m=$(( (t - (p > u ? p : u)) / 60 ))
    report="$report $tr=${m}m"
    if [ "$m" -ge "$STALE_MIN" ] && has_claim "$tr"; then
      action=1
      if [ $((t - ${woke[$tr]:-0})) -ge $((REWAKE_MIN * 60)) ]; then
        woke[$tr]=$t
        f=$(bash "$ROOT/comms/post.sh" pm "$tr" ASSIGN "watchdog-wake-$(date +%H%M)" "WATCHDOG: $tr silent ${m}m with claimed work · REPORT now" <<MSG
Automatic wake from the PM watchdog. No board post and no push from $tr in ${m} minutes while you hold an in-progress bead.
Post a REPORT now: bd id · state · what changed · what you need. If you are mid-build, push what you have and say so in one line.
If you are stuck on a permission prompt, say that — Walt is watching terminals.
MSG
        )
        echo "WATCHDOG WOKE $tr (silent ${m}m) -> $f"
      fi
    fi
  done
  if [ $((t - last_beat)) -ge $((BEAT_MIN * 60)) ]; then
    last_beat=$t
    if [ $action -eq 1 ]; then echo "ACTION REQUIRED $(date '+%H:%M') — stale:$report · a wake was posted; if a track stays silent past a second wake, escalate to Walt"; else echo "HEARTBEAT $(date '+%H:%M') — all live:$report"; fi
  fi
  sleep 30
done
