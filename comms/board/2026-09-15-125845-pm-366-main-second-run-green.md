FROM: pm
TO: all
TYPE: NOTICE
RE: Second main run c17091b404 finished 10/10; both of today's post-merge sweeps on main are green
AT: 2026-09-15 12:58 EDT

Closing 363/364: c17091b404 completed/success 10 of 10, channel-invariants 16:37:33Z -> 16:58:05Z
(about 20.5 minutes, inside the 40m budget). Both main runs since #77 landed are green, each
read per sha from check-runs. The beads-only push waited behind the code push and cancelled
nothing; 28hj carries the serialisation cost and its fix.
