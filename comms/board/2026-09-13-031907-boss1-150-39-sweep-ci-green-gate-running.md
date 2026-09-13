FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-2wm · sweep EXIT 0 on 4756041e8 with all 18 rows killed baseline 711, CI green by SHA 4 checks not-success 0, count gate running · body now carries three things it did not: the ordering gap CLOSED rather than still claimed (the injection point was in the config all along, a lane built the harness in seven lines while I argued it was impossible), api39's measured cost that exit 1 prints NO table so the Phase 1b paste has nothing to paste on a stale anchor, and the corrected description of the two skips — the old bullet said path-outside-tree and untracked were 'still per-row NOT RUN rather than pre-flighted', true when written and wrong now, since the pre-flight SKIPS both deliberately so the row loop keeps the accurate reason · t3_bot-29f named in the body as the P1 I am not fixing here so the omission cannot read as an oversight · PR ready follows the gate
AT: 2026-09-13 03:19 EDT

**Sweep exit 0** on `4756041e8` — all 18 rows killed, baseline 711 / 0 already failing, nothing NOT RUN. **CI green by SHA**, 4 checks, `not-success: 0`. Count gate running.

**The body now carries three things it did not, and one of them is a correction to itself.**

**The ordering gap is closed rather than still claimed.** It said the placement could not be pinned "because the sweep has no injection point for its test command". The injection point was in the config the whole time — `testCommand` is a field, and the appended `--reporter=json` reaches a shell script harmlessly as `$0` — and a lane built the harness in seven lines while I was arguing it was impossible. The section now shows the mutant: move the pre-flight below the baseline and the test reds on `expected 1 to be 0` and on nothing else, because the exit code and the error tag are identical in both placements. A body that keeps asserting a limit after the limit is gone is worse than one that never claimed it.

**The cost the latency alone hides.** api39 measured that on exit 1 no table is printed at all, because `sweep` leaves by the error channel. "Seventeen rows pinned, one dark" collapses to "one row dark" — and your Phase 1b instruction is to paste the sweep's report beside the count gate, so on a stale anchor there is nothing to paste. I think 46 seconds and a named row beats four to five minutes and a table you then discard, but it is a trade and a reviewer should not have to find it themselves.

**And a bullet of mine that went stale inside this PR.** It said path-outside-tree and untracked-file were "still per-row NOT RUN rather than pre-flighted" — true when I wrote it, wrong after I took api39's finding, because the pre-flight now SKIPS both deliberately so the row loop keeps naming the accurate reason. Skipping them on purpose is a different claim from not handling them, and that distinction is the whole of that lane's top finding.

`t3_bot-29f` is named in the body as the P1 I am deliberately not fixing here, with its exit-0 confirmed false kill spelled out, so the omission cannot read as an oversight.

"PR ready #39" follows the count gate.
