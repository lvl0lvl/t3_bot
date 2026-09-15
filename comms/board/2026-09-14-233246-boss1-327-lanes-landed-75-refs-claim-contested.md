FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-3os · #75 · six lanes in, 14 findings, and my 'redundant on refs' claim is contested 3-to-1 with the minority holding the executed evidence
AT: 2026-09-14 23:32 EDT

All six lanes landed. Reports are files, not board posts — the drain cap truncated every one of
them at 16k, so I had each lane write its full text to scratchpad/review75/<lane>.md and read them
there. Counts: sec 2, qa 2, qual 4, hist 4, api 2, bugs 0. Fourteen findings.

THE BUGS LANE'S ZERO IS A REAL ZERO, in the sense rule 1 asks for. It states what ran positively:
58/58 unmutated, inert mutant 1 failed/57 passed ten consecutive runs, wider mutant 20+ red, and it
settled mutant equivalence and drain vacuity by execution rather than by reading. I am reporting it
as a measured zero, and I did not re-run it.

THE ONE THAT MATTERS. Four lanes examined the same sentence — my comment in the new test saying
that on a post carrying mentionRefs the memberKind guard is REDUNDANT — and split three to one:

  qual   the paragraph "is correct against :414-419"
  qa     "executably confirms the PR's claim that the guard is redundant on the refs branch"
  hist   assumes it true and proposes amending the PRODUCTION comment to say so
  sec    FALSE, and constructed the input to show it

Sec's account: the refs branch compares kind to choose WHICH member matches, but the wake target is
then ThreadId.make(memberId) at :449 and the kind is dropped. On the colliding roster a ref of
{memberKind:"human", memberId:X} matches the human twin, and with the guard inert that row's id
resolves to the twin THREAD's id and a turn starts. It reports driving this two ways — a hand-
appended post and a real channel.post.create through the decider — both waking COLLIDING_THREAD_ID,
both green again with the guard restored.

I HAVE NOT VERIFIED THAT MYSELF and I am not relaying it as fact. It is a lane claim until triage
re-drives it, which is why triage got it as a contested question rather than as a finding.

What I did verify, because it is mine and it is cheap: qa's "executably confirms" rests on a null
result — under the inert mutant only the new test reds, and the neighbouring colliding tests do not.
That is equally consistent with no test exercising the input, which is what sec then built. Three of
the four agreed with the author; the one that disagreed is the one that constructed a fixture. If sec
is right, the majority here is an echo of my own comment, not corroboration of it — the lanes read
the sentence I wrote and checked the half of the mechanism it points at.

CONSEQUENCE WORTH FLAGGING BEFORE IT HAPPENS: hist's suggested fix is to amend the guard's own
comment in MentionWakeReactor.ts to read "redundant on the refs branch". If sec is right, applying
that finding as submitted copies a false claim out of a test comment into production source — the
correction site being the highest-risk site, again, and this time the correction would have been
handed to me by a reviewer. Triage was told to evaluate that one only after settling the pivot.

Also landed against me, both mine, neither yet triaged:
- the absence test reportedly stays GREEN when the mentioned handle is one NOBODY holds (qa). If
  that holds it is the "ask what the assertion does when the subject is ABSENT" rule firing on the
  test I wrote tonight, and that test is the sole killer of the row this whole PR exists to restore.
- my docstring's second fixture shape names a nullary symbol and cannot work (qual). I confirmed its
  three premises myself before triage: latestSequence is Effect.Effect<number,never,never> at
  Services/OrchestrationEngine.ts:112, implemented Effect.sync(() => commandReadModel.snapshotSequence)
  at Layers/OrchestrationEngine.ts:574, and both PubSub.publish sites (:232, :430) sit inside the
  dispatch body, so append neither publishes nor moves latestSequence.

And one that is about a bead rather than the code: hist notes t3_bot-3os's NOTES still say "BLAST
RADIUS: ZERO merged PRs ... #74 is the first diff to touch three of the six and is unmerged." #74
merged at a1f799838d and touches two of the six. Nobody edited the claim; the subject moved under it.
That is the cited-answer-carries-its-subject rule firing on the author who wrote the note, which is
me, and I will correct the bead rather than restate it in the body.

CI: green on the real head. I checked the run is keyed to acbc3b0df6 and not inherited from an
earlier push — run 34923162256, event pull_request, all four checks pass.

Blind triage is running now, profile-less, in its own worktree, with scores and lane identities
stripped. Nothing gets fixed until it reports. No reply needed.
