FROM: boss1
TO: pm
TYPE: REPORT
RE: #17: 3 criticals, one root cause — the sweep's dirty-tree refusal failed open and could destroy uncommitted work. Fixed and proven at 753f9d262
AT: 2026-09-12 12:07 EDT

t3_bot-a4i · in_progress · **#17's lanes found 3 CRITICALS in the sweep, one root cause, and they
were right** · fixed at `753f9d262`, pushed · #19 triage in: 0 hallucinated, 2 merge-blockers ·
ajw's contract layer committed and pushed · three #17 lanes died on the usage limit.

## The sweep could silently destroy uncommitted work

`capture` awaited the child's exit code and **threw it away**, with stderr piped to `"ignore"`. So
two of the five refusals — including the dirty-tree refusal, the one whose whole anecdote is that
`git checkout --` destroyed my own work three times — were properties of **git succeeding**, not
properties of the tool.

Point it at a directory that is not a git repository: `git status --porcelain` exits 128, writes its
complaint to the discarded stderr, leaves stdout empty, and `"".trim() === ""` reads as CLEAN. The
sweep mutated an uncommitted file, the `git checkout` restore failed silently under `Effect.ignore`,
and the run **exited 0 printing "1 survivor. Nothing in this suite depends on those lines."** with
the content gone.

**sec17 and qual17 reproduced that independently.** I reproduced it too and then re-ran the same
probe against the fix: exit 1, a tagged error carrying git's actual stderr, file byte-identical.

`capture` now returns `{stdout, stderr, exitCode}`. It cannot blanket-fail on non-zero — the test
command is *expected* to exit non-zero, since a killed mutant is a failing suite — so each caller
says what it means: four must succeed, the test command must not, the worktree finalizer stays
tolerant and now says out loud what it left behind. The restore is `orDie`, because continuing would
sweep the next mutation against a still-mutated tree and attribute the result to the wrong line.

## The tool's own thesis was its unpinned guard

**qa17: `judge` could be switched to decide by failure COUNT and all 15 tests stayed green.** 13 of
its 23 mutants survived. Refusal 2 is "it never infers a kill from a failure COUNT" and nothing held
it. Each existing fixture differs in *cardinality* between baseline and mutant, so both
implementations agree on all three — a careful assertion over a fixture that cannot exercise the
property, written into the tool built to find exactly that.

Added the input that separates them: equal size, disjoint membership — one flaky test heals while
the mutation kills a real one. `apps/server` carries 12 such failures, so it is ordinary rather than
contrived. Proven: the count-based mutant reds that test **and only that test**.

## And I walked into my own header

`readVitestJson` promised unparsable output is `total: 0` and instead **threw** — the first-brace
fallback sliced from any brace a test logged. Fixing it meant two independent parts (anchor on the
reporter's key; guard the parse), and the header already says a two-part defence needs one mutation
per part. **It took three fixtures.** My first two were each rescued by one part alone, so the
mutant restoring the fallback survived twice over assertions I was confident in. The input no single
part rescues is a test logging an object that PARSES — which the fallback turns into a *fabricated*
measurement rather than a missing one. Both parts now pinned separately, each by one named test.

Tests 15 → 19. `vp check` 0, `vpr typecheck` 0. End-to-end sweep re-running now.

Also fixed: the header said "FOUR THINGS IT REFUSES TO DO" and listed five — second stale count of
mine a lane has caught in two days, in the file whose subject is measure-don't-assume. And it gained
the caveat #19 earned: **a constant needs its DEFINITION mutated, not only its call sites.**

## #19 triage: 31 findings, 21 legitimate → 10 defects, 0 hallucinated

Two merge-blockers, and one is not what any lane thought:

1. **The test assertion** — and triage caught that the security lane's suggested fix is **inert**.
   `assert.strictEqual(issuers[0], HUMAN_OPERATOR_ISSUER)` is still a comparison against the mutated
   constant; it ran it and the mutant lived. Take the bug lane's: spell the literal. A four-lane
   convergence where one of the four fixes does nothing.
2. **`ws.ts:510-523`** — triage read `gh pr diff 18` and found **#18 carries that paragraph as
   unchanged context** and adds `connectionIssuer` beneath it. Every lane assumed your rebase would
   sweep it. It does not: the sentence is false in #19's tree, #18's tree, and the merge. It is now
   on main. I fix it on the rebase.

And the thing triage most wanted me to know, which is fair: **a retraction in a PR body does not
retract from a docstring.** I withdrew the type argument in #19's body while
`orchestration.ts:592-600` still asserts it. That one dies with the constant on the rebase.

Cheaper than I filed: `bin.test.ts:806` already POSTs the dispatch route through the real engine, so
`t3_bot-7rj`'s integration test is a fixture change in an existing file, not a new harness. Noted on
the bead.

## ajw

`ac478ca1e` pushed: the wire contract for the paged read plus the cursor codec **moved** out of
`channelGatewayLive` into `orchestration/channelCursor.ts` — moved, not copied, because that format's
failure mode is a lie rather than an error and cannot afford two decoders. 77 comms tests still green.
Next: the shared handler and the two transports.

## Lost to the usage limit

`hist17`, `bug17` and `api17` died mid-run — history, bug-hunter and contracts on #17. I have
security, quality and test-coverage. Say whether you want those three re-dispatched after the reset
or whether #17 goes to triage on three lanes; my read is that the three criticals are the substance
and a bug-hunter pass on the fixed `capture` would be worth more than the other two.
