FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-a4i · #17 head f8bf3b3ab rebased onto 024633919 · fork CI GREEN (4/4) · count-gate exit 0 for scripts/ · API-17-06, -07, -09 closed plus qa25's TEST-25-08 remedy · api17 is verifying now; 'PR ready #17' when it answers
AT: 2026-09-12 15:10 EDT

#17 is green on both gates and its last three findings are closed. I am holding the
"PR ready" line until api17 answers, because two of the four changes are ones I would
want a second reader on and I have said why below.

GATES, both from the command's own exit code:

  fork CI on f8bf3b3ab — Fork Check, Test Server 1, 2, 3 all PASS
  TEST_COUNT_GATE_TARGET=scripts/ pnpm test:count-gate --base origin/main — exit 0
      measured scripts/ against origin/main
      scripts/guard-sweep.test.ts   0 -> 34
      no test lost by count or by name
  vpr typecheck — exit 0
  vp test run scripts — exit 0, 422 passed / 10 skipped / 31 files

The two `.cjs` failures this suite used to carry are gone: they were the root vitest
project collecting `node:test` files, which is the thing f79ff67ff fixed after this
branch's gate run surfaced it.

WHAT CLOSED.

API-17-06. `requireCleanTree` lived inside `sweep`, so on the worktree path it ran AFTER
`setupCommand` had written to a tree freshly detached at HEAD — anything it found was
necessarily the install's own output, and the message told the operator to commit it.
"Commit first", about a temp directory the finalizer then deletes. The precondition is the
caller's now: `--in-place` checks the operator's own tree before anything else, and the
worktree path does not check at all.

API-17-07. `--in-place` returned before the setup block, so a configured `setupCommand`
was discarded in silence under a flag whose doc said "omit it only with --in-place" — which
told an author omitting was safe and implied providing it was honoured. It still does not
run there, and for a stated reason: an install writes into the tree the operator is working
in, and repointing a link inside a shared `node_modules` is the write that left 653 tests
green over 12,246 type errors. The run announces the skip; the field says so.

API-17-09. `id` is the report's only row identity and nothing checked it was distinct. Two
rows sharing one produce a summary naming a row that also appears as a kill.

And TEST-25-08, which qa25 raised against this tool on #25. An unrelated OTLP-export test
reddened in ONE run of a mutation touching only the channel-posts HTTP door and stayed
green in four re-runs; I then hit a second instance with a different test in the same
shared `it.layer` block. `confirm` re-runs a candidate kill with the mutation still applied
and keeps only reds present in both. One re-run, not three — an intermittent test can pass
twice, so it narrows the window rather than closing it. Only on a candidate kill, because a
flaky red can turn a survivor into a kill and never the reverse.

WHY I WANT api17 ON IT BEFORE SAYING READY. Two of these could be worse than what they
replaced and I cannot see it from here:

- The confirming run happens inside the `Effect.ensuring` that restores the file, so the
  mutation is still applied. If I got that nesting wrong, the second run measures the
  UNMUTATED tree and every kill silently becomes a survivor — a far worse tool than the one
  the lane reviewed. I have asked api17 to prove what the second run actually measures
  rather than read it.
- Not checking the scratch worktree for cleanliness at all rests on my claim that nothing
  of the operator's can be in a tree created detached at HEAD. If there is a case where a
  restore there destroys something, I have made the tool worse.

HOW I VERIFIED, since the three handler findings cannot be reached from the pure-core test
file: 34 unit tests (8 new), and twelve checks driving the real CLI against throwaway git
repos, of which FOUR fail on the previous commit and pass on this one —
`scratchpad/prove17_handler.py` runs the probe against both versions and prints which
checks flip, restoring from a byte copy.

A fifth check passes on both versions and I am not counting it: "setup did NOT run before
the refusal" holds on the old code too, because the old `--in-place` path never reached
setup either. It documents the ordering rather than proving it.

One more thing worth recording, because it is the same mistake in a new place. My first
version of that probe invoked the tool through a command that does not exist, so nothing
ran — and "setup did NOT run" PASSED, because the marker is absent when the tool never
opens the config. Twelve checks, several of them green for the reason that nothing had
happened. The probe now refuses to report anything unless the tool started. That is the
fourth time today a check passed over a subject that could not exercise it.

#25 separately: head 4bb00db1b (a beads commit on top of the CI-green 8a0e58ce9, so CI is
re-running), gate output in the body, qa25 verifying, and des25 still out on DES-25-02.
