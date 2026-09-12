FROM: boss3
TO: all
TYPE: INCIDENT
RE: CI IS DOWN FOR BILLING, NOT CODE — every job on #13 refused before starting, 2-3s each: 'recent account payments have failed or your spending limit needs to be increased' · needs Walt, no session can fix it and no rerun clears it · the merge gate is now unobtainable for #13, #14 and zuy · do NOT read this red as a code failure, and do not let it make the next red one background noise
AT: 2026-09-12 06:46 EDT

CI IS DOWN FOR BILLING, NOT FOR CODE. Every job on #13 is being refused before it starts. This needs
Walt; no session can fix it and no rerun will clear it.

WHAT I SAW, on run 34689236690 (PR #13, sha 8e66af132):

    X Fork Test Server 3 in 2s
    X Fork Test Server 1 in 2s
    X Fork Check in 3s
    X Fork Test Server 2 in 2s

    ANNOTATION (identical on every job):
    "The job was not started because recent account payments have failed or your spending limit
     needs to be increased. Please check the 'Billing & plans' section in your settings"

Two-to-three seconds is the tell. A real failure on this repo takes four minutes; these never ran.
`Collect PR targets` and `Prepare PR size config` failed the same way, which is why it is the whole
account rather than one workflow.

WHY I AM RAISING IT RATHER THAN RETRYING: a red gate that is not about the code is the most dangerous
shape of red, in both directions. Retry it and you burn time on something no commit can fix; read it
as a code failure and you go looking for a defect that is not there; and the reverse risk is worse —
"the gate is red" becomes background noise, and the next red one, which IS the code, gets waved
through with it.

WHAT THIS BLOCKS. The merge gate is "Fork green on the rebased sha", and that is now unobtainable for
everyone, not just me:
  - #13 cannot be declared ready. My last green was 4 of 4 on 0d290d4b3 over base 245b65c76, and the
    branch has had six commits since — including the parent-id decode, both suspends and the
    conflation test. Local: 789 tests in src/mcp + src/orchestration, 390 contracts, tsc exit 0. That
    is evidence, not a gate, and I am not going to let it be mistaken for one.
  - #14 is in review and will hit the same wall when it gates.
  - zuy's slices queue behind both.

WHAT I SUGGEST, and the choice is yours and Walt's, not mine:
  1. Walt fixes billing and the gates run as normal. Cleanest, and everything resumes with no rule
     bent.
  2. If M1 cannot wait, you rule explicitly that a named local run substitutes for the Fork gate, and
     that ruling goes in each PR body naming the exact sha and command — so "merged without CI" is a
     recorded decision rather than something someone reconstructs later from a green that never
     happened. I would want that written down even if it is only for a few hours.

I am not proposing 2 and I would rather not merge on it. I am naming it because the alternative to a
stated exception is an unstated one.

Meanwhile I am continuing to work on #13 locally — there is real work left that does not need CI, and
the blind verifier's pass does not depend on GitHub.
