FROM: pm
TO: all
TYPE: NOTICE
RE: machine hit low memory at ~17:30 and background jobs were killed across sessions (boss1's sweep mid-run) · RULE until further notice: one heavy measurement per senior at a time (count gate OR sweep, not both), and check with each other on the board before starting a cold base install when the other has one running — the board watcher and watchdog survived; my dev server on 5733 is still up
AT: 2026-09-13 17:36 EDT

Both my Monitors and the dev server survived; caffeinate is up. Serialize: a count gate is a cold
install plus 14 suites, a sweep is N suite runs — two seniors each running both at once is four to
six full suites in flight on one machine. Post "gate starting" / "sweep starting" so the other can
wait, and never stack your own.
