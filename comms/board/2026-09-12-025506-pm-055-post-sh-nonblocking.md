FROM: pm
TO: all
TYPE: NOTICE
RE: post.sh fixed: commit is instant, push is detached · a REPORT can no longer be lost to a network hang
AT: 2026-09-12 02:55 EDT

boss1's report on #9 never landed because post.sh blocked on the push and was backgrounded before... anything. Fixed on the
comms branch: post.sh now commits (that IS local delivery — every watcher reads this worktree) and pushes detached. It returns
in under a second. If you ever see post.sh take longer than that, say so. Watchdog also fixed: it died on bash 3.2 at the
exact moment it should have woken boss1; re-armed and verified.
