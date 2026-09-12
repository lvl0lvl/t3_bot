FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-7rj · PR #31 READY at c36c80c17 · guard sweep EXIT 0 for the first time, all ten rows killed baseline 691 · repo-wide count gate exit 0 across 13 workspaces (desktop SKIPPED-unmeasurable named with wjt) · CI green by SHA · QA lane corrected my body: Effect.exit->flip is what kills the mutant, NOT the message assertion, which discriminates a different input (post.create with an absent channel) · 3 beads filed, jaq is P1 with a proven surviving mutant on a client-supplied path gate · 1ez pushed at bbe274de9, prover and gate owed
AT: 2026-09-12 19:01 EDT

**PR #31 is ready at `c36c80c17`.** All three instruments on that head, body sections generated from
their logs.

- **`pnpm test:count-gate --base origin/main` — exit 0**, the repo-wide gate #28 shipped. 13 workspaces
  measured, nothing lost by count or by name. `@t3tools/marketing` skipped (no `test` script) and
  `@t3tools/desktop` **SKIPPED, unmeasurable in a cold base tree** with `t3_bot-wjt` named — which is the
  new gate doing the thing the old one could not: saying what it did not measure instead of measuring 12
  and calling it the repo.
- **`guard-sweep` — exit 0**, baseline 691 / 0 already failing, nothing NOT RUN, **all ten rows killed.
  The first time the channel-invariants sweep has exited 0.** `issuer-required-fails-open` is killed by
  `refuses every channel command that arrives without an issuer`, by name.
- **Fork CI green by SHA**, 4 checks, `not-success: 0`.

**The QA lane found an error in my body and it is the interesting part of this PR.** I wrote that the
message assertion is what distinguishes the two implementations. It is not. The lane stripped BOTH
assertions, kept the flip, and the mutant still died: under that mutation the defect propagates out of
the `yield*` before either `expect` runs. **`Effect.exit` -> `Effect.flip` is the discriminator.** Wrong
in the dangerous direction, because the wrong version invites restoring `Effect.exit` while keeping the
assertions, which restores the hole in full.

It also established what I had not: the `toContain` IS the sole discriminator, on an input I never named.
Six of the seven commands call `requireCommandIssuer` first in their branch; `channel.post.create` has
`requireChannel` ahead of it, so against an absent channel a different invariant refuses first and
satisfies the tag while the issuer guard is gone. Measured both ways. So both halves are load-bearing for
different reasons and neither is the reason I gave.

And it killed a third claim: "the difference between a rejection on the wire and an unhandled 500" is
false on the HTTP door, where `Effect.catch` maps the typed error to `failEnvironmentInternal` as well.
Handled-500 versus unhandled-defect is the honest statement. What holds — a typed failure is catchable by
tag and a defect is not, with a live caller doing exactly that in `git/linkCreatedPullRequest.ts` — is
what the comment says now.

All three corrections are in the test comments and the body, and `expect(refused).toEqual(...)` is
recorded as the enumeration check it has become, since the push turned unconditional in this diff.

**Three beads, and the first is worse than what this PR fixes:**

- **`t3_bot-jaq` (P1), with a proven surviving mutant.** `workflowScriptQuery.test.ts` asserts only
  `_tag === "Failure"` off an `Effect.exit` against a function with six distinguishable reasons. Drop the
  `.js` half of the extension gate on a **client-supplied request path** and the suite stays green, 3
  passed, measured. Two failures compound: the assertion cannot tell the reasons apart, and the fixture
  names a file that is never created so `not-found` stands in for `not-js` either way. The stronger idiom
  is five lines below in the same file.
- **`t3_bot-nqf` (P2).** The HTTP dispatch door presents an authorization refusal as
  `orchestration_dispatch_failed`. The socket door was not measured and the bead says so.
- **`t3_bot-61g` (P3).** Ten `Exit.isFailure` assertions on authorization refusals in
  `AntigravityAuth.test.ts`, labelled pattern-matched rather than proven because the lane did not build
  mutants for it, with "measure before fixing" in the acceptance.

**1ez is next and is already rebased and pushed** — `boss1/t3_bot-1ez-member-ref-unique` at `bbe274de9`,
780 tests green across orchestration and the comms toolkit. Owed before its PR: the mutation prover (both
axes, plus the `find`/`findLast` row I expect to SURVIVE by design) and the repo-wide gate.

One thing I fixed in 1ez's draft body while waiting, because it is the same defect in miniature: it said
"seven other references moved with it, three of them prose", which adds two different things together
wrong. Measured: seven identifier references (three in the decider, four in the seam test) and three
prose mentions, across eight files with the sweep config's three `guard` fields. That is the seventh
unmeasured number of mine today, and the only reason I caught it is that I have started treating every
figure in my own prose as a claim to run.
