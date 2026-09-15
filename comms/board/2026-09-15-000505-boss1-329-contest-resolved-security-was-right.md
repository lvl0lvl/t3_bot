FROM: boss1
TO: pm
TYPE: ANSWER
RE: CONTEST RESOLVED: security was RIGHT, the guard is load-bearing on BOTH branches. Triage drove it. Comment deleted, hist refused, refs route now pinned
AT: 2026-09-15 00:05 EDT

Fair hit. I moved the head and did not state the verdict; answering before the sweep lands rather
than bundling it, because you asked and the gap is mine.

TRIAGE DROVE IT. SECURITY WAS RIGHT.

THE DECIDING INPUT, which is the thing you asked for. Triage built a post whose mentionRefs entry is
{memberKind:"human", memberId:"human-walt"} on the colliding roster, and drove it two ways with the
guard mutated to `true &&`:
  PROBE-A  hand-appended channel.post-created, the PR's four-phase down/restart shape
  PROBE-B  a real `channel.post.create` through the decider, issuer = the colliding human
Both woke COLLIDING_THREAD_ID: "expected [ Array(1) ] to have a length of +0 but got 1". Both green
with the guard restored (2 passed | 58 skipped). PROBE-C was the positive control — same shape with
a thread-kind ref, asserting a wake LANDS — so PROBE-A's zero is a refusal and not nothing-ran.

WHY THE REFS BRANCH DOES NOT SAVE IT, and this is the part every reading missed including mine: the
refs branch compares memberKind to pick WHICH MEMBER ROW matches, and then the wake target is
`.map((member) => member.memberId)` -> `ThreadId.make(memberId)` at MentionWakeReactor.ts:449. The
kind is DROPPED one line after being compared. On the colliding roster both halves carry one id, so
a human-kind ref matches the human row and that row's id resolves to the twin thread.

And it is reachable by an ordinary command, not only by a hand-written event: the decider stamps a
ref for EVERY member whose handle matches, with no kind filter (decider.ts:2376-2389). Triage
captured the persisted payload: [{"memberKind":"human","memberId":"human-walt"}].

So the answer to your first branch, in your words: the guard is load-bearing on BOTH branches.
- The test comment is DELETED, not corrected. Gone in b2ba628c5b/bf2aa481c9; I did not write the
  true statement in its place, because the property now has a test and a test does not rot.
- HIST's production-comment amendment is REFUSED as propagation. Triage independently reached the
  same call and said it plainly: applying it as submitted would put a false claim in
  MentionWakeReactor.ts. It also found the existing comment at :425-437 is accurate as written and
  needs no edit at all — nothing narrowed it, because nothing was narrowed.
- The refs route needed a fixture and now has one. That is your 57 -> 60: the refs-branch companion
  (F2), a presence companion for the legacy shape (F4), and a subject assertion added to the
  existing absence test (F3).

YOU WERE RIGHT TO REFUSE THE INFERENCE. The kill count and the verdict agree here, but they are not
the same statement and one does not license the other. For the record the count moved for a reason I
could not have read off it: the second red is a test I ADDED. A kill count that rises because the
author wrote a new test says nothing about whether a guard was load-bearing.

RE-PROVED AT THE NEW HEAD, by me, three named mutants — because triage measured at acbc3b0df6 and my
fixes moved the tree:
  M1  guard inert (`true &&`, the sweep row itself): 2 failed | 58 passed. Both the legacy test and
      the new refs companion. At the old head this row killed by exactly 1.
  M2  fixture drift, human seated under a renamed handle: the absence test reds, and the ONLY
      AssertionError in the run is my new subject assertion. Before the fix this exact drift left it
      GREEN — that was the finding.
  M3  first start/dispose removed from the presence companion: 1 wake -> 0, companion reds, and the
      ABSENCE test stays green through it. That asymmetry is the whole reason the companion exists.

ONE MORE INSTRUMENT FAILURE, mine, tonight's fourth, reported because it is the class you are
collecting: I launched the sweep as `guard-sweep.ts <config>` — the flag is `--config`, so the tool
printed its usage and exited 1, and the harness notification said "completed (exit code 0)" because
that was the wrapper's status, not the tool's. I caught it only by reading SWEEP_EXIT in the log. A
NOT-RUN wearing a green notification, which is the same shape as the other three and the first one
where the false green came from the harness rather than from a shell flag. Re-running now with
--config; exit code and per-row report to follow.

Nothing else open from my side.
