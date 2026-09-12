FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-ami · #29 head ac0541843 rebased onto d5259d687 · FIRST PR through the new Phase 1b step: guard-sweep exit 2 and the row this PR exists for flipped SURVIVED -> killed · the exit 2 is 7rj (issuer-required-fails-open), pre-existing and not mine · count-gate exit 0 · qa29, bug29, hist29 in flight; CI running
AT: 2026-09-12 16:23 EDT

#29 is the first PR through the sweep step you added on merging #17, so the report is worth
reading as much for the instrument as for the PR.

`node scripts/guard-sweep.ts --config scripts/guard-sweep.channel-invariants.json` — **exit 2**,
baseline 685 tests, 0 already failing, nothing NOT RUN.

  inert  requireCommandIssuer          issuer-required-fails-open           **SURVIVED**
  inert  requireIssuerCanAuthor        author-allow-list-admits-system      killed
  wider  requireIssuerCanAuthor        author-allow-list-refuses-threads    killed
  inert  requireIssuerCanAdminister    administer-allow-list-admits-threads killed
  wider  requireIssuerCanAdminister    administer-allow-list-refuses-system killed
  inert  requireChannelAuthorIsMember  author-membership-matches-id-only    killed
  wider  requireChannelAuthorIsMember  author-membership-never-matches      killed
  inert  requireChannelAbsent          channel-absent-inert                 killed
  inert  requireChannelHandlesUnique   handles-unique-inert                 killed
  wider  requireChannelMemberShape     member-shape-refuses-every-human     killed

THE ROW THIS PR EXISTS FOR FLIPPED. `author-membership-matches-id-only` is the survivor that
opened `t3_bot-ami` — measured against `origin/main` at afb1dc782 with a 637-test baseline — and
it is `killed` here, by one test, the one this PR adds. That is the instrument confirming its
own finding closed, which is the first time we have had that.

THE EXIT 2 IS NOT MINE, and I want to be explicit rather than let a non-zero code sit
unexplained in a PR body. The survivor is `issuer-required-fails-open` = `t3_bot-7rj`, the
sweep's other survivor from the day it was written, `requireCommandIssuer`'s documented
fail-closed property. Open, unrelated to the author lookup, and next-but-one in my queue. Exit 2
says "a survivor was measured", which is the true statement about this tree; nothing was NOT
RUN, so the survivor list can be read as complete.

One thing worth knowing for everyone's budget: the confirmation step means a candidate kill
costs TWO suite runs, so nine killed rows is about nineteen runs of
`apps/server/src/orchestration`. The full sweep took several minutes of wall clock on this
machine. Worth it, and worth knowing before someone puts it in a tight loop.

`TEST_COUNT_GATE_TARGET=apps/server pnpm test:count-gate --base origin/main` — exit 0,
`decider.issuer.test.ts` 29 -> 30, no test lost by count or by name. `vpr typecheck` 0.

Both outputs are in the body with their scope lines, per your ruling.

LANES IN FLIGHT on #29, and I scoped them deliberately rather than running all six on a
one-test PR — say the word if you want the rest:
  qa29    — the PR is a test, so vacuity and fixture-ordering are its lane. Told to run the
            mutant itself rather than take my word, and to look for a third degradation
            neither direction of my sweep covers.
  bug29   — not the test: whether the PR's REACHABILITY claim is true. I assert the colliding
            pair cannot be added by a command and only arrives by replay. If a live path
            creates it today, the bead's priority is wrong. Also asked to trace whether
            anything downstream — mention resolution, the wake reactor — resolves a member by
            id alone, in which case the impersonation survives this PR's test.
  hist29  — because your history lane found four Important things on #25, all of them claims
            of mine that did not match the record. Told to check this PR's historical
            assertions the same way, and specifically whether a previous PR body ever pasted a
            sweep report claiming this row was killed.

Fork CI is running on ac0541843; I will report green by SHA rather than by `gh pr checks`,
for the reason in my 15:47 note.

Nothing else claimed. p4u after this, then 46h with 7rj — and 7rj is the survivor above, which
makes that pairing read better than it did when you set the order.
