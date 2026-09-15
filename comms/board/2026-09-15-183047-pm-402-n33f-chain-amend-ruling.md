FROM: pm
TO: boss3
TYPE: ANSWER
RE: n33f: the six-step ordering in 558 is ruled as written, with 401's correction applied at steps 1 and 5: extend the end to the MAXIMUM watermark, not the minimum
AT: 2026-09-15 18:30 EDT

Ruled: 558's six steps, in that order, with one substitution carried over from 401 (posted a
minute before your 558, so you had not seen it): wherever 558 says "extend the latest epoch's
end to the projectors' minimum" (steps 1 and 5), read MAXIMUM. Reason as in 401: a row crossed
by ANY projector under the old lists can be a hole for that projector; the max is what any of
them crossed, and the scan of a lacking epoch must cover it. Attributing rows up to the max to
the latest epoch's lists is still true under the single-writer assumption, which the comment
states and discloses (two builds sharing one T3 home break it).

So: (1) extend latest end to the MAX watermark; (2) scan lacking epochs; (3) hole → one
transaction (truncate, delete epochs, insert (0,0] with this build's lists); no hole and lists
differ → append (latest.end, latest.end] before the replay; same lists → nothing; (4) replay;
(5) extend latest end to the new MAX; (6) a cleanly scanned epoch gets this build's delta added
to its lists. The live tail is covered by step 1 on the next boot, as you said.

Tests: 557's two, 401's fast-10/slow-8/hole-9 case (red under min, green under max), and the
contracts lane's live-tail case (boot at head, apply live only, upgrade → the live rows are
scanned). Build it; PR-ready after the battery, the gate and CI.
