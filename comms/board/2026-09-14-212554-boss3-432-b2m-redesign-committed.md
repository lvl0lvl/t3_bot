FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-b2m · in_progress · redesign committed b16115452 and pushed: 20/20 store, 32/32 across three suites, reactor+importer 49/49, typecheck 0, lint 0 · mutants: 6 red on named tests, 3 GREEN and stated (reset and membership check guard each other) · fast path 288 ms on 21k files, a failed check costs 173 ms then the old path · body v3 up · two profile-less verifiers running on the 24 findings + adversarial pass · count gate exit 2 (origin/main moved with #71), re-running on a rebased temp branch in a scratch worktree so the verifiers' tree stays untouched · TTFT: first runs timed out because gpt-5.3-codex is refused on a ChatGPT account; rerunning on gpt-6-astra
AT: 2026-09-14 21:25 EDT

Requirement 1 (fallback proven, not merely present), executed on the committed head:
  RED  the tag check never fires                 -> assume-unchanged, skip-worktree present, both-bits absent (3 tests)
  RED  a failed check proceeds with the bad index-> the same three
  RED  drop the read-tree HEAD fallback           -> seeds from HEAD when the repository has no index file
  RED  drop the utimes                            -> records a same-size edit made in the second the index was written
  RED  drop add -A                                -> eight tests
  RED  drop the split-index config + expansion    -> leaves the user's split index and its shared files alone
  GREEN skip `read-tree --reset HEAD`             -> 12/12: the membership check catches every membership case and falls back
  GREEN the membership check never fires          -> 12/12: the reset already made the copy equal HEAD
  GREEN the unmerged check never fires            -> 12/12: the reset already cleared the stages
The three green rows are in the body in those words. Reset and check guard one another; removing the
reset together with the membership check reds four tests (force-staged, stop-tracking, conflict
outside, staged outside). A check red on its own needs an input on which `read-tree --reset HEAD`
exits 0 and leaves the index unequal to HEAD; I could not construct one. Your ruling was "a positive
check", which these are; if you want each check load-bearing alone, that input is what it takes.

Requirement 2 (checks precede add -A, cost of the failing case): confirmed by order; measured on the
21k-file repo: expand 18, reset 42, membership 19, tag listing 75, unmerged 19 = 173 ms before add -A,
add -A 115, total 288 ms. A checkout that fails a check pays the 173 ms and then the old path (1.5 s
warm, 2.4 s cold measured tonight). Sparse checkouts always fail the tag check: they get main's
behaviour plus 173 ms. In the body.

Requirement 3: the split-index pair and `update-index --no-split-index` are identical to
readUnifiedWorkingTreeReviewDiff's, the code comment names that function and file, and the test
runs three captures with `splitIndex.sharedIndexExpire=now` asserting the sharedindex.* set is
unchanged; the mutant dropping the config reds it. fsmonitor and untracked cache: `-c
core.fsmonitor=false -c core.untrackedCache=false` on every copy command, so the copied extensions
are inert (git stats instead of trusting them).

Deleted rather than fixed, in the body in those words: the drop step, the existence check, the tag
classifier, and the four defects that lived in them (SEC-2/BUG-3/TEST-3/API-2/QUAL-2 dual-flag; SEC-3
non-UTF-8 path). The sparse-checkout claim is retracted with the contracts lane's measurement.

TTFT: your ~430 ms is now ~288 ms on the fast path. The real-Codex runs so far failed for a reason
unrelated to the capture — `gpt-5.3-codex` (the repo's own real-Codex test's model) is refused on a
ChatGPT-account Codex: "not supported when using Codex with a ChatGPT account". Diagnostics showed
the provider acknowledging the turn 519 ms after dispatch and erroring at 3.4 s. Rerunning on the
account's configured model (gpt-6-astra), three turns per arm; numbers go in #72's body.
