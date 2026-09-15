FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-28hj · all three of your 399 rulings applied and pushed at 330a7e86ac · battery is now ELEVEN mutants, nine red by name, two green BY DESIGN including CLAIM 8's admit side · F2 filed as t3_bot-a9mg · waiting on boss3's slot for the gate and on CI
AT: 2026-09-15 18:28 EDT

bd id · state · what changed · what you need

  t3_bot-28hj · round three applied, NOT yet PR-ready · head 330a7e86ac (pushed, ref compared)
  · need the heavy slot after boss3 (their n33f gate is still running per 555) · nothing from
  you unless something below is wrong.

F1 — CLAIM 8, max-parallel. Reads `strategy` on the sweep job from the parsed document.
Admits no `max-parallel` key at all, or a cap >= the config count. Both directions measured:

    max-parallel: 1   -> reds "runs the sweep's configs in parallel, so no strategy key
                         re-serializes them" BY NAME
    max-parallel: 6   -> STAYS GREEN

The second row is the point, not padding. Raising the cap to the config count is a legitimate
edit, and a guard that refuses what it ought to admit is the guard the next person deletes —
your own rule about the admit side usually being the feature.

F4 — CLAIM 6 now pins `on.pull_request` as well. Both new directions red by name:

    pull_request: branches: [main]              -> RED
    pull_request: types: [opened, labeled]      -> RED

with the message naming the consequence: every PR not targeting main would lose CI silently.

F3 — the message. `expect(value, "why")` is supported by this runner; I probed it rather than
assuming, since the whole point was a failure that explains itself. CLAIM 6's three assertions
each carry their reason now, including the merge_group sentence in your words.

I ALSO RENAMED THAT TEST, because after F4 its name was a lie: it said "the push trigger ...
tags included" while four mutants that hit it now include two `pull_request` ones. It is
"pins both triggers in both directions: nothing new reaches the sha arm, and no PR loses CI".
Re-ran all four mutants under the new name to confirm each still reds by it. This costs no
allowance — the test is new in this PR, so the base has no name to lose.

YOUR TIMEOUT INSTRUCTION, honoured by deletion rather than by marking. The sentence is gone
from the test comment entirely; CLAIM 8 rests on nothing about the timeout clock. The body
carries it under "Not covered" as documented-not-measured-by-either-of-us. I did not spend a
CI run measuring it because CLAIM 8 does not need it to be true.

F2 — filed as **t3_bot-a9mg** (P3), with the lane's B1 and C3 measurements written in AND an
explicit line saying those two are the lane's and were NOT re-run by me, unlike F1/F3/F4 which
I did re-run. It also names the trap for whoever closes it: `uses:` can point at another repo
at a ref, which cannot be resolved from the tree, and that case needs a decision rather than
silent admission.

F5 — one line in the body, as you asked: all 17 workflows read, no group string can collide
with `fork-ci-<sha>` or `fork-ci-<pr number>`.

FULL BATTERY, eleven mutants from the committed tree, controls both sides, porcelain clean
between every row: group, cancel, twofail, widen, tags, prnarrow, prtypes, jobconc, maxpar1
all red BY NAME; reformat and maxpar6 green by design.

REMAINING: count gate at 330a7e86ac (waiting on the slot; the row becomes 4 -> 8 and the four
allowances carry over unchanged, since the describe() rename is the same one), and CI on
330a7e86ac. CI was 10/10 green at 30bf932af6.

Body is rewritten and includes the section your ruling asked for — "what this PR now rejects
that used to work" — stating the merge_group consequence plainly rather than leaving it for
someone to discover.
