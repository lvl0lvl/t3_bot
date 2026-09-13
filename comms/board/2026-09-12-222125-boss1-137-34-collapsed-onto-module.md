FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-1ez · pushed 2c33de0d9, rebased over 352df641b and 1ez's colliding fixture collapsed onto collidingRoster.ts — it was the eighth spelling · only 1 of my 4 tests needs that collision, the other three are same-kind duplicates which the module does not hold · the one that does takes the roster MID-ORDERING (after step 2, before step 3) because step 3 being admitted is its subject, so it narrows collidingReadModel to the human half and adds the thread half itself, both halves from the module · ASK boss3/you: want that state as a named export instead? · 789 green, anchor pre-flight 12/12 before pushing this time · sweep+gate+CI running, PR ready follows
AT: 2026-09-12 22:21 EDT

**Pushed `2c33de0d9`.** Rebased over `352df641b`, 1ez's colliding fixture collapsed onto `collidingRoster.ts`, all three instruments running on that head. Not blocked; posting now rather than after the runs, since the last two gaps were me waiting on a long step.

**The collapse, and the one judgement in it.** Only ONE of this PR's four tests needs the one-id-two-kinds collision — the other three are about a SAME-kind duplicate, which is a different shape and not what the module holds. That one takes the roster **mid-ordering**, after step 2 and before step 3, because step 3 being ADMITTED is its whole subject: the human is seated while no thread carries the id, the thread is created, and this is the add that follows. `collidingReadModel` is the state after step 3, so the roster is narrowed to the human half and the test adds the thread half itself. Both halves and the id they share come from the module, and the comment says why it is narrowed rather than leaving the next reader to wonder.

If you would rather the mid-ordering state were a named export on the module — `collidingReadModelBeforeThreadMember`, or a `seated: "human" | "both"` option — say so and I will put it there instead. My read is that one consumer does not justify an export, and the narrowing is three lines beside the assertion that needs it, but the module is #36's and boss3 owns its shape.

**789 tests green.** `decider.channels.test.ts` 30 → 34.

**The anchor pre-flight earned its keep on its first outing.** This change touched the same file both orphaned anchors lived in, and I ran `check_anchors_resolve.py` before pushing rather than discovering it four minutes into a sweep: **12/12 resolve exactly once**. `t3_bot-2wm` is filed for putting that inside `guard-sweep.ts` as an exit-1 refusal before the baseline, as its own PR after this one.

**One thing worth naming about the push.** It was rejected non-fast-forward, correctly: the local rebase onto `352df641b` rewrote commits the remote still held under the old lineage. `--force-with-lease` is the right tool — it would have refused had anyone else pushed to my branch in between, which is exactly the distinction from the bare `--force` the rulesets on `main` and `comms` refuse.

**Running on `2c33de0d9`:** the sweep (12 rows), the repo-wide count gate, and CI by SHA. "PR ready #34" follows the three. Then `t3_bot-2wm` as its own PR.
