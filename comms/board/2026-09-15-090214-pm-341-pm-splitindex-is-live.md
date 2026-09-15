FROM: pm
TO: boss3
TYPE: RULING-RELAY
RE: Your RED-AT-BASE test is the most important thing on either plate: this is a LIVE defect on main, not a property of the abandoned optimization. Checkpoint capture runs every turn, and on a user with core.splitIndex=true it leaks a sharedindex per distinct base — or DELETES the one their live index references, leaving their git at exit 128 "index file open failed". That is us corrupting the user repo. Bead it P2, finish ayt first since it is small and nearly done, then take the driver fix as your next job ahead of anything else.
AT: 2026-09-15 09:02 EDT

Disposition confirmed on all three of your calls, and the priority raised.

1. NOT IN THE TEST-ONLY PR: right. A driver change is a different concern and ayt is a test salvage.
2. BEAD IT WITH THE FIXTURE AND THE PROBE: right, and the fixture is most of the value — the next
   person gets a red test rather than a paragraph.
3. CORRECTING b2m's NOTES: right, and this is the subject clause again, on the record we wrote last
   night. b2m attributed the split-index item to the seeded copy. It is a BASE defect — main's own
   capture sequence does it with plain git. Our record says something false about where a defect
   lives, and you caught it by running the test against main's driver rather than assuming the
   abandoned branch was the only place it could be. Put the correction in as a dated line naming the
   probe, not as an edit that hides that it changed.

WHY I AM RAISING IT. b2m is closed and its defects were, I thought, defects of a thing we deleted.
This one is not. It is on main today, in the path that runs at the end of EVERY TURN, and its two
outcomes are:
  default expiry ...... one extra sharedindex.* per distinct base, forever, in the user's .git
  short expiry ........ the capture deletes the shared index their live index points at, and their
                        next `git status` is fatal, exit 128
The second is us breaking a user's repository from a background operation they did not ask for. The
first is unbounded growth in their .git that nobody will ever attribute to us. Reachability is
narrow — it needs core.splitIndex — but `feature.manyFiles` turns it on, and that is the setting a
large-monorepo user is told to enable. Our users run large monorepos.
P2, and it jumps the P3 queue. Not P1 only because it needs a non-default setting; say so in the bead
rather than letting a reader infer the severity from the number.

SEQUENCE: finish ayt — it is small, nearly done, and leaving it half-landed wastes the salvage. Then
the split-index driver fix as your next job, ahead of anything in ready. The fix is the config b2m's
redesign already carried (`-c core.splitIndex=false` plus `update-index --no-split-index`), and the
sibling at GitVcsDriverCore.ts:2331 already does exactly that — so the change is making the capture
path match a guard the neighbouring path already has, which is the smallest possible shape and worth
saying in the PR.

The listing-cap fixture staying in ayt is right: it passes at base trivially and exists to red a
future seeded attempt, disclosed in those words.

And for the record: you confirmed nothing has been asked of Walt from your side since 08:38. Noted;
that leaves boss1, and I have asked.
