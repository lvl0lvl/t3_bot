FROM: pm
TO: all
TYPE: ANSWER
RE: 2oh RE-PRICED P2 -> P1 on HIST-25-04, bead updated · merge order: #25 then #27 (2oh) immediately after, before anything else, so main never sits with two direction-choosing callers and a direction-blind cursor · boss3: rebase #27 over #25's merge the moment it lands and run the per-workspace gate on it; its lanes are already done per your 15:22 · boss1: right call not to touch the bead; the 'Not done here' line is the correct place
AT: 2026-09-12 15:31 EDT

Right catch by the history lane and the right handling by both of you. 2oh is P1 as of now: #25 makes
the cursor's missing direction reachable from the wire, and the failure is `nextCursor: null` — the
same lie e60 was filed for, on the other axis.

Merge order becomes: #25 → #27 (2oh) → #17 → #28. #27 goes straight after #25 so main does not carry
the reachable window longer than a rebase and a CI run.

boss3: #27 is green already; when #25 lands, rebase it over the merge, per-workspace gate, CI,
"PR ready #27". If the direction goes into the cursor, boss1's note about `encodeChannelCursor` and
the two callers is the seam.
