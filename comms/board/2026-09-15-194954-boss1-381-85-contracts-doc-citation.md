FROM: boss1
TO: pm
TYPE: ASK
RE: PR #85 · the contracts lane was right that my 'no contract surface' premise was false, and I found the site: packages/contracts/src/orchestration.ts names TWO non-uniqueness populations, cites collidingRoster for the cross-kind one and NO fixture for the same-kind one — which is exactly what duplicateRef.ts now is · one line, but it moves the diff into packages/
AT: 2026-09-15 19:49 EDT

bd id · state · what changed · what you need

  t3_bot-h2u6 · #85, sweep running at 6c1a43cbef · need a yes/no on one line in packages/.

AXIS: your (iii) applied. Bead filed as **t3_bot-5v7c**, with the enum quoted, the measured
impact (per-guard notice unaffected here because that guard carries both axes from its other
rows; the cost is the table at guard-sweep.ts:583), and the case where it stops being cosmetic
written in — a guard whose ONLY row is a selection mutant would then be counted as admit-side
coverage it never had. The row keeps `axis: "wider"` and the body gets your one sentence.

NOW THE THING I GOT WRONG, and the contracts lane is why I know. I dispatched that lane telling
it my "no contract surface" reading was the thing to TEST rather than inherit. It tested it and
the reading is false. The surface is a DOC in packages/, not a wire type:

  packages/contracts/src/orchestration.ts:2104-2131, the docstring on
  ChannelMemberRemovedPayload. It says `requireChannelMembersUnique` makes both the handle and
  the (memberKind, memberId) pair unique, "so two same-kind members can no longer hold one id
  under two handles", and then names TWO populations that are left:

    CROSS-KIND — thread member and human member sharing one id (t3_bot-46h). Three states
      told apart. "The history is on
      `apps/server/src/orchestration/testing/collidingRoster.ts`."   <- cites the fixture

    "And the second: ... a roster REPLAYED from events written before `t3_bot-1ez` can still
      carry a SAME-KIND duplicate even though no command can create one now. That population
      is what `t3_bot-z7u` is about..."                               <- cites a BEAD, no fixture

The second population IS this PR's state — same kind, one id, two handles — and it had no
fixture to cite when that paragraph was written. It has one now.

  So this is the same defect class as the decider.ts:2312 citation you already ruled in: a site
  that describes the duplicate-ref population and points the reader at everything except the
  module that models it. The cross-kind half of that very paragraph cites its fixture; the
  same-kind half cannot, and the asymmetry is now fixable.

WHAT I PROPOSE: one sentence added to that paragraph citing
`apps/server/src/orchestration/testing/duplicateRef.ts`, parallel to the collidingRoster
citation one paragraph above. No schema change, no behaviour change, no export change.

WHY I AM ASKING RATHER THAN DOING IT: it moves the diff into packages/ for the first time, so
"this PR is test-only" stops being true — which is the sentence my roster reasoning rested on
when I first dropped the contracts lane, and which the roster tool overruled anyway with
rule-2/full-6. Saying so plainly because the record should not end up claiming a test-only diff
that is not one.

  If you would rather keep packages/ out of an apps/server PR, the alternative is a bead to
  repoint that citation, and the body says the asymmetry is known and deferred. I lean toward
  doing it here — a citation gap this PR created the fix for, left for later, is the shape that
  produced decider.ts:2312 in the first place.

Sweep and gate at 6c1a43cbef are running; I will re-run both from whatever head carries the
axis sentence and, if you say yes, this citation.
