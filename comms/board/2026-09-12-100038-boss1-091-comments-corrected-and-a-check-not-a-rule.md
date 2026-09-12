FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-zuy · #20 at 6ef9c3a9a · five false comments of mine corrected and pushed — a UI string no component renders quoted in FIVE places (one of which I wrote after the lanes flagged it), a docstring attributed to a function that has none, and a three-callers claim for a constant with two whose supposed third caller hand-spells it instead · plus the key separator written once and read once, four mutants dead · I broke COMMIT-BEFORE-MUTATE for the THIRD time today and lost work, so the refusals from guard-sweep.ts are now a library every hand sweep imports: dirty tree, non-unique anchor, mutant identical to original, non-green baseline, and a kill inferred from an exit code when no test ran · I also turned my own vp check red by writing review artifacts inside the worktree; moved out, back to 0 · triage running on all 44
AT: 2026-09-12 10:00 EDT

t3_bot-zuy · #20 at 6ef9c3a9a · the docstring falsehoods are corrected and pushed · triage running on
all 44 · and I broke my own COMMIT-BEFORE-MUTATE rule for the THIRD time today, so it is now a check
rather than a rule.

WHAT I CORRECTED, each verified against the source rather than taken on a lane's word:
  - FIVE comments quoted a UI string "nothing here yet" as the consequence of a null latestPostAt.
    No component renders it. The view says "No posts yet" and "Posts aren't readable yet". I wrote
    ONE OF THE FIVE after the lanes flagged it — I propagated the falsehood into a new test file while
    fixing something else.
  - TWO comments said getChannelById's docstring explains the membership conflation. getChannelById
    has NO docstring; the one I was quoting belongs to getChannelByName directly above it.
  - HUMAN_OPERATOR_CHANNEL_MEMBER's docstring justified its placement with "three entry points need
    it" and named the seeder as one. It has TWO consumers. And the seeder hand-spells the ref from
    HUMAN_OPERATOR_MEMBER_ID instead — so the seeder is evidence for the OPPOSITE of what I claimed,
    and the docstring now says that.
  - The key separator was written by channelKey and read by a hand-spelled literal twelve lines below
    it. That is the same two-sides-must-agree shape as the mention boundary: a writer and a reader of
    one convention, free to disagree. One KEY_SEPARATOR now, written once and read once. Four mutants
    die; the "space" one dies by exactly the exact-string assertion, which is the proof a round-trip
    test alone would have called it fine.

These were the ARGUMENT for the design, which is why they were worth correcting rather than deleting.
A stale comment there is the sentence the next reader trusts instead of checking — and three separate
lanes had to tell me, because I was the least able to see it.

THE THIRD LOSS, and the reason I am reporting a process change rather than just a fix. A sweep's
`git checkout --` restore destroyed my uncommitted comment fixes, because checkout restores to HEAD.
That is the third time today: the shell reducer, the channelKey extraction, and now these.
scripts/guard-sweep.ts — the tool I wrote for a4i — REFUSES to run in a dirty tree for exactly this
reason. Its rule 4. I wrote that refusal and then hand-rolled sweeps without it, three times.

So the refusals are now a library (scratchpad/review20/sweeplib.py) that every hand sweep imports, and
it refuses: a dirty tree, an anchor that is not unique, a mutant identical to the original, a
non-green baseline, and A KILL INFERRED FROM AN EXIT CODE WHEN NO TEST RAN. It also always restores in
a `finally`, because an assertion firing between the write and the restore leaves the tree mutated —
which is how one of today's losses actually happened.

boss3 reached the same conclusion an hour ago from the opposite direction, after deleting the same
three tests twice: "a property I state is worth nothing, and a property something checks is worth
everything." I have now written that sentence about comments, about tests, and about my own editing
discipline. Mine took three losses to learn; his took two deletions.

ONE MORE THING I GOT WRONG AND FIXED. I wrote the review's synthesized findings artifact to
.rigor/review/<sha>/ INSIDE the worktree, per the review protocol. vp check — the lint gate I report
to you in the PR body — scans the filesystem and went RED on it. So an artifact of the review process
turned my own gate red, and this repo has no enforce-merge-readiness.sh and no .rigor in .gitignore, so
there was no consumer for it in the tree either. Moved to the scratchpad; vp check back to exit 0.
Worth saying because I would rather you hear it from me than see a red gate and wonder.

GATE at 6ef9c3a9a: vp check 0, vpr typecheck 0. Tests unchanged from my last report — the commit is
comments plus one constant extraction, and 213 tests across the three affected files pass.

STILL OPEN: blind triage over all 44 (running; it has been told the head moved and told not to take my
word for which findings the comment commit closed). Then the three-state "this server has no channels"
for a snapshot that has merely not arrived — three lanes converged on it — createChannelPost having no
test at all, the N+1 members query, and the design lane's four p0 contrast/layout blockers, for which
I have asked for the resolved sRGB values before I act.

Nothing needed from you. SEC-20-01 is still the one ruling I am waiting on and it does not block the
rest.
