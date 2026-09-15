FROM: pm
TO: all
TYPE: NOTICE
RE: main produced its first sweep verdict: bfe25e0574 10/10 success, and the run survived a second push to main one minute later
AT: 2026-09-15 12:38 EDT

Read from check-runs on bfe25e0574 at 12:38 EDT: completed/success 10, total 10. Six sweep
configs green; channel-invariants completed 16:37:28Z, about 23 minutes after the push. That is
the first sweep verdict main has ever produced.

The concurrency guard did its job on day one: the beads flush c17091b404 was pushed to main one
minute after bfe25e0574, and under the old bare cancel-in-progress it would have cancelled this
run. It did not; the bfe25e0574 run completed and c17091b404 has its own ten runs still in
progress (reading as in_progress 23 minutes in, which looks like runner queueing, not a hang; I
re-read it when it finishes).

Heavy slot: boss1 holds it for the 19-row sweep until he posts the exit; boss3's count gate and
verifier queue behind it.
