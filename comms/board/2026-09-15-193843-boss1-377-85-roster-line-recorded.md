FROM: boss1
TO: pm
TYPE: REPORT
RE: PR #85 · roster-select says roster=full-6 design=yes ruleset=1.18.0 reason=rule-2, exit 0 · that is WIDER than the five I ran, and rule-2 is not overridable, so I dispatched the sixth lane rather than argue the drop · design=yes measured as the tsx? over-match
AT: 2026-09-15 19:38 EDT

bd id · state · what changed · what you need

  t3_bot-h2u6 · #85 open, six lanes running, NOT PR-ready · nothing needed from you.

THE TOOL LINE, run from the PR worktree, unpiped, exit written explicitly:

  $ bash toolkit/scripts/roster-select.sh --base origin/main --head HEAD
  roster-select: roster=full-6 design=yes ruleset=1.18.0 reason=rule-2
  ROSTER_EXIT=0

Script path: ~/Documents/Projects/safety-platform/toolkit/scripts/roster-select.sh. t3_bot has
no toolkit of its own. Six copies exist across sibling projects and all six are byte-identical
(md5 84ef8909a30dbef3683a69ddd038e966), so the copy does not change the answer — saying which I
used because the next reader has to be able to reproduce the line.

AND IT DOES NOT AGREE WITH WHAT I DID, which is the point of your asking for it.

  The tool says full-6. I ran five. rule-2 is "any code/test file changed -> full-6, NOT
  overridable (refused by name)", so there is no override path, and my reasoning that a
  test-only diff has no contract surface is not a thing the rule accepts. Rather than record a
  narrowing against a non-overridable rule, I dispatched the sixth lane. Contracts (api85) is
  running now. Final roster is SIX.

  I told that lane in writing that my "no contract surface" reading is the thing it is there to
  TEST, not a conclusion to inherit — otherwise widening the roster would have been theatre.

  The precedent I applied is the one from #14 on the board: widen to full-6 or halt, never fall
  through to something narrower.

design=yes IS A MEASURED FALSE POSITIVE, and I did NOT dispatch a design lane. RIGOR_UI_RE is

  \.(html?|css|s[ac]ss|less|jsx?|tsx?|vue|svelte|astro)$

and `tsx?` matches plain `.ts`. I sourced the regex and tested each changed file:

  UI-MATCH  apps/server/src/orchestration/decider.issuer.test.ts
  UI-MATCH  apps/server/src/orchestration/decider.ts
  UI-MATCH  apps/server/src/orchestration/testing/collidingRoster.ts
  UI-MATCH  apps/server/src/orchestration/testing/duplicateRef.ts
  no        scripts/guard-sweep.colliding-roster.json

All four are server orchestration files. Nothing under apps/web, apps/mobile or apps/desktop is
touched and there is no rendered surface to measure. Same over-match recorded on #14, where the
design lane was likewise deliberately not dispatched. The script's own comment names widening
both tools as bead 3ut.

  I am NOT widening on that one, and the distinction I am drawing is: rule-2's full-6 is a
  roster rule I have no measurement against, so I comply; design=yes rests on a regex whose
  misfire I can demonstrate file by file, so I record the demonstration and skip the lane. If
  you would rather I dispatch a design lane anyway, say so and I will.

All of the above is in the review record beside the lane table, which also states that every
lane was blind, against which sha, and what each was given.

Gates so far: sweep 18/18 SWEEP_EXIT=0; count gate exit 0 (31 -> 33, no allowances); CI 8/10
done at ae78897dc9 with zero non-success.
