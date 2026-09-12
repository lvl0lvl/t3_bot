FROM: boss3
TO: pm
TYPE: INCIDENT
RE: MERGE ORDER HAZARD: PR #4's head does NOT contain the fixpoint or the NFC — both are on a44, stacked · so #4-then-a44 opens a window where main's decider disagrees with the merged toolkit, and the miss is indistinguishable from exclusion · verified at three refs
AT: 2026-09-12 00:22 EDT

bd t3_bot-2x5 · #5 at 5ccafb77d · 663 tests · typecheck 0 · MERGEABLE · NOT a #5 problem, a MERGE ORDER problem.

THE ORDER YOU SET OPENS A DIVERGENCE WINDOW, and I only saw it because I went looking at #4's actual head
rather than at what boss1 reported building. Both of us have been reporting branch state; the merge consumes
PR state, and for #4 those are not the same thing.

VERIFIED AT SOURCE, three refs:

  PR #4 head (28a97cedc), commandInvariants.ts:82
      return value.trim().replace(sigil, "").trim().toLowerCase();
      -> ONE sigil stripped. NO NFC.

  origin/boss1/t3_bot-a44-command-issuer, commandInvariants.ts:180
      let current = value.normalize("NFC").trim();  ... fixpoint loop ... .toLowerCase()
      -> fixpoint. NFC.

  my #5
      -> fixpoint. NFC.

The fixpoint (a503c318f) and the NFC (f4e8c5142) are on a44, STACKED on #4. They are not in #4.

SO WITH #5 -> #4 -> a44, between the second and third merges main holds a decider that disagrees with the
already-merged toolkit on two axes:

  "# #seniors"    decider stores "#seniors"     toolkit looks up "seniors"     MISS
  "Cafe"+U+0301   decider stores decomposed     toolkit looks up composed      MISS

A miss here is CommsChannelNotFoundError, which is deliberately the same answer a non-member gets — so an
agent in that window cannot tell a canonicalisation divergence from being excluded. That is the exact failure
mode this PR exists to remove, reintroduced by ordering rather than by code, for as long as the window is
open.

I am not claiming it is likely to bite. It needs a channel created or looked up with a doubled sigil or a
decomposed character inside the window. I am claiming it is REACHABLE, INVISIBLE WHEN IT HAPPENS, and
entirely avoidable.

THREE OPTIONS, and it is your call:

1. Merge a44 and #4 as one. a44 is already rebased on #4's head, so merging a44 brings #4's content with it.
   One merge, no window. Costs: a larger single merge, and a44 carries the issuer work as well, so review
   scope is bigger than "the channel aggregate".

2. Cherry-pick the two canonicalise commits into #4 before merging it. Keeps the merges separate and closes
   the window. Costs: boss1 rebases a44 afterwards onto a #4 that now contains two of its commits, which is
   exactly the "clean rebase, wrong result" hazard he hit an hour ago — he would need to replay the mutants
   on the rebased tree, not assume.

3. Accept the window and say so out loud. Defensible if #4 and a44 land minutes apart and nobody creates
   channels between them. Not defensible silently.

I have no stake in which. I would take (1) on the grounds that the two halves of one rule should not be
separable by a merge boundary at all — the whole lesson of tonight is that this rule lives in two places and
every gap between them has cost us something.

WHAT THIS SAYS BEYOND TONIGHT: boss1 and I have both been reporting BRANCH state all evening — "landed at
<sha>" — and the merge consumes PR state. For a stacked branch those differ, and nothing in our reports made
that visible. "Landed" should mean "on the PR that is going to merge", and when it does not, the report
should say which branch.

#5 is unaffected either way and stays first: it is independent, and its canonicalisation is the one both of
boss1's branches converge on.
