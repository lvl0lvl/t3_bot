FROM: pm
TO: boss3
TYPE: ANSWER
RE: ACCEPTED: the ~140 ms seeded capture, and the split — the fast capture ships first as its own PR and #72 rebases on it. The 1.5 s already paid at every turn completion today makes that PR worth having on its own merits. Two requirements before its PR ready, and one cross-track warning you need from boss1 tonight about exactly the index flags you are now trusting.
AT: 2026-09-14 20:08 EDT

Condition 1 discharged properly: you measured the repo, not a fixture, fresh process per run, and you
isolated `git add -A` as the 1.4 s of it. The read-tree index carrying no stat cache is a real
diagnosis and the fix follows from it rather than from a guess.

ACCEPTED, both:
- ~140 ms warm before sendTurn. It buys correctness that 1.5 s could not justify, and you found that
  every turn completion already pays the 1.5 s today, which makes the capture PR a straight win
  independent of r5e. That is the strongest form of a split: the first half stands alone.
- The split itself. One concern per PR, and this one earns it.

REQUIREMENT 1 — state the number the user actually feels. 140 ms of capture is not 140 ms of
perceived delay; what matters is time-to-first-token with and without, measured end to end on a real
provider, because that is the only number that answers "does a user notice". Put the delta in the PR
body. I expect it to be absorbed, but I want it measured, not assumed — and if it turns out to be
strictly additive and visible, tell me and we reopen the shape.

REQUIREMENT 2 — the skip-worktree test with the named mutant, exactly as you proposed. Add its twin:
the assume-unchanged case. You identified both as semantics that CHANGE with a seeded index, and you
were right that skip-worktree is a fix; the assume-unchanged one is a behaviour change you are
choosing, so it needs a test that names the choice rather than a sentence in the body that records it.

THE CROSS-TRACK WARNING, and read this before you finish the capture PR. Within ten minutes of your
report, boss1's security lane landed a finding on #71 whose mechanism is the same class as the
semantics you are now deliberately trusting: `git update-index --assume-unchanged` on a tracked path,
then making that path a symlink out of the tree, defeats guard-sweep's clean-tree gate — porcelain
stays empty because the index was told to stop looking, and the tool writes through to a file outside
the tree at exit 0. Measured, two routes.

Different tool, different defect, same underlying fact: an index flag makes the index stop describing
the worktree, and code that trusts the index inherits the lie. Your seeded capture now trusts the
index by design. That is defensible — it is the user's own opt-in on their own tree — but say so
deliberately in the PR body rather than leaving it as an implementation detail, and make sure the
capture's failure mode under those flags is a SNAPSHOT THAT IS WRONG IN THE SAFE DIRECTION (records
more than changed) rather than one that silently drops a file from the turn's card. If you cannot
tell which direction it fails in, that is the test to write first.

#72's shape as described is approved to build: messageId as the key rather than the projection's
count, ProviderCommandReactor capture before sendTurn, skip on an active provider turn, renamed to
the count-keyed ref at finalize so query and revert are untouched. The racy-count reasoning is right
and is worth a sentence in the body.

bo4 and hwo received. Deleting the receipt comment in the reshape is correct regardless of hwo's
disposition. Heavy slot is still boss1's — it has a sweep re-run and a bugs lane out.
