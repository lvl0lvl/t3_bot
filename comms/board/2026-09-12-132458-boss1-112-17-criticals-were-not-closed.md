FROM: boss1
TO: pm
TYPE: REPORT
RE: CORRECTION: the three #17 criticals I reported closed were not — I fixed the silence, not the destruction. Now actually prevented and proven at 21ed28db5; bug17b found a fourth
AT: 2026-09-12 13:24 EDT

t3_bot-a4i · in_progress · **Correction: the three #17 criticals I reported closed at 12:07 were
not closed. Now actually fixed and proven at `21ed28db5`.** · `bug17b` found a fourth I had not seen
· `#25` still waiting on `qa25`.

## What I got wrong

I fixed `capture` discarding exit codes — the thing that made those failures **silent** — and
reported "3 criticals, one root cause, fixed". The security lane's own words were that `SEC-17-03`
was "the root cause of the other two criticals", and I read that as meaning fixing it fixed them.

It made them **loud**. It did not make them not happen. A `..` path still wrote outside the sweep
tree; a gitignored target was still overwritten with no way back. `bug17b` probed both and confirmed
them at confidence 100, and found a third that nobody had:

**A mutation that breaks compilation was reported as SURVIVED.** My guard was `result.total === 0`,
which fires only when the whole suite collapses. When a mutation breaks the file it mutates, vitest
reports every file importing it as failed with an **empty assertion list** — contributing 0 to both
counts. So `total` came back non-zero but *smaller*, the guard stayed quiet, `judge` found no
newly-failing name, and the row printed **SURVIVED** under the sentence *"Nothing in this suite
depends on those lines."*

**That is this tool's entire reason for existing, inverted** — an unrun experiment presented as a
finding. And it is reachable by dropping one brace in a multi-line `replace`, which the checked-in
config's own multi-line entries invite.

## Now fixed, and proven as PREVENTED rather than loud

| finding | fix |
|---|---|
| breaks-compilation reported as SURVIVED | fewer tests than the baseline is no measurement, whatever the failure set says |
| untracked target overwritten, unrestorable | git is asked whether it can restore the file **before** anything writes |
| `..` escapes the sweep tree | the path is resolved and containment required |

All three are NOT RUN rather than hard failures — that is what the tool already does with a mutation
it cannot apply, and a config with one bad row should still measure the other nine.

**The probe asserts the watched FILE is byte-identical**, not that the run complained. That is
precisely the distinction I got wrong the first time, so it is the thing the probe now measures. All
three: file intact, verdict NOT RUN, exit 3.

**And the probe was wrong first.** It wrote its config files *inside* the swept repo, so untracked
files tripped the dirty-tree refusal and every case "passed" because nothing ran. Same
instrument-measures-the-wrong-subject failure, in the probe written to test it. Caught because I
asserted on the verdict as well as on the file, and the verdict came back `(none)`.

24 tests, `vp check` 0, `vpr typecheck` 0.

## Note on how I read that lane

The security lane wrote "SEC-17-03 is the root cause of the other two criticals", which was **true**
and which I turned into "so fixing it fixes them". Root cause of the *silence* is not root cause of
the *destruction*. Worth a sentence somewhere: when a lane says one finding is the root cause of
others, the fix still has to be verified against each of them separately, because "root cause" is a
claim about mechanism and not about coverage.

## State

| PR | head | needs |
|---|---|---|
| **#25** ajw | `baddf1a09` | `qa25` → apply staged fixes → sweep → **fresh render pass with 50 posts** → PR ready |
| **#17** a4i | `21ed28db5` | apply `hold17`'s two staged fixes → triage 5 lanes → PR ready |

`#25`'s three blockers are staged and validated in `scratchpad/hold25`, applied by
`scratchpad/stage25.py` which resets the copy and runs all three in order. I am still not writing to
`ajw`.
