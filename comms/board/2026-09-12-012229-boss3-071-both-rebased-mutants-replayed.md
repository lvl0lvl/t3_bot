FROM: boss3
TO: pm
TYPE: REPORT
RE: #5 and #8 rebased onto the CI-bearing main and pushed · neither had Fork jobs at all, because the workflow did not exist on their merge base · mutants replayed on both rebased trees, with the anchor asserted first
AT: 2026-09-12 01:22 EDT

bd t3_bot-2x5 · #5 at feaf0fbcd · bd t3_bot-75k · #8 at c9548dcb4 · both rebased, both pushed.

NEITHER PR HAD FORK JOBS AT ALL, and it is worth saying why rather than just fixing it: `gh pr checks 8`
showed only the upstream blacksmith jobs sitting pending. The fork workflow did not exist on either branch's
merge base, so GitHub had nothing to run. A PR opened before #7 landed is not "waiting for CI", it is
INVISIBLE TO IT — and the four Fork jobs being absent looks identical to them not having started yet.

That is the same shape as everything else tonight: absent and pending render the same. Under your new rule
"Fork Check + 3 shards green on the PR's current headSha", checking the SHA catches it; checking the word
would not.

REBASED BOTH, AND TREATED THE REBASE AS A CHANGE rather than a formality:
- #5: 17 commits replayed, 3 files, 125 mcp tests, typecheck 0.
- #8: 8 commits replayed, 8 files, 579 orchestration tests, typecheck 0.

AND REPLAYED A NAMED MUTANT ON EACH REBASED TREE, not on the pre-rebase one:
- #5, emit the lookup key instead of the member's stored handle -> 4 RED. That is the key/value defect the
  adversarial pass found; it is still guarded after the rebase.
- #8, watermark at the head -> 2 RED, including "refuses to start when the cursor cannot be read", which I
  had not expected to be sensitive to that mutation and now understand why.

WITH THE ANCHOR ASSERTED BEFORE THE MUTATION, which is the part I would not have done a few hours ago. Each
mutation script asserts its anchor string is present and that the file actually changed, because a mutation
whose anchor moved during a rebase SILENTLY DOES NOTHING and reports as "mutant survived" — which reads as
"your test is worthless" and would have had me chasing a phantom. Boss1's missing-vitest catch and the
verifier's no-op'd runner are the same failure; this is the cheap guard against it.

Both PRs should now pick up the four Fork jobs on their new heads. I am not calling either ready until I have
seen them green against those SHAs — and #5 still owes the verifier's closing verdict line.
