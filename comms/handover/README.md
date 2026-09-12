# Handover artifacts

Things built during a session that must outlive it. Not production code — kept
here because the `comms` branch is pushed and the scratchpads are not.

## `commsSeam.integration.test.ts.txt`

Built by the security lane during `/review-pr` on PR #5, then rewritten by it to
assert correct behaviour rather than snapshot the bug it found.

**Why it exists.** Every other comms test fakes the `ChannelGateway` and asserts
what the toolkit *sends*. This one imports the decider's real
`commandInvariants` and runs the toolkit's output through them. The two halves
diverged twice in one evening — once on how many leading sigils a name loses,
once on whether a handle is case-folded — and **both times every test on both
sides stayed green**. A fake of a seam agrees with whatever the toolkit does, so
it cannot catch a disagreement with the aggregate by construction.

**What it pins.**

1. A name canonicalised by the toolkit is a name the decider stores.
2. A handle emitted by `comms_read_channel` is a handle the decider resolves.
3. Distinct members stay distinct end to end — no two collapse into one mention key.
4. A non-member and a non-existent channel are one answer, byte for byte.

**When to land it.** With `t3_bot-iin`, once the channel aggregate is on `main`.
It needs the decider branch present: the three imports from
`orchestration/commandInvariants.ts` are the contract, and it is written so that
if those move, it fails rather than skips.

**LANDED 2026-09-12 in PR #10 (t3_bot-iin), ADAPTED rather than unmodified.** The note below was
written before #6 canonicalised handles in the decider, and by the time this landed its fixtures
named a membership the aggregate refuses (`Walt` and `walt` in one channel) and asserted a
case-shifted mention was unresolvable. Both were correct against the aggregate it was built on.
The landed version derives its membership from the decider's own canonicalisation, so a fixture
cannot assert a state the aggregate would refuse. It also records what it can no longer see: with
canonical membership, emitting the lookup key and emitting the stored handle are the same bytes,
so the key/value rule is pinned in `handlers.test.ts` instead.

**The two renames are APPLIED — the file was ready to drop in but not to run unchanged.**
Both were the only ones needed. The toolkit's is aliased as
`toolkitCanonicalChannelName` so the decider's keeps the bare name it has
everywhere else.

**Verified on the tree `main` becomes** (boss1, 2026-09-12): a44's head merged
with `boss3/t3_bot-2x5-canonical-names`, own install, workspace links confirmed
resolving inside the scratch tree. Combined tree 785 tests / 80 files green,
typecheck 0. This file: 6 tests, all pass, with no edits beyond the renames.

**It still bites**, which is the only thing that makes it worth landing. Two
mutations of the seam, each confirmed RED:

| mutation | result |
|---|---|
| toolkit stops folding case on names | 3 RED, incl. "the toolkit's name rule and the decider's agree, input for input" |
| toolkit emits the lookup key instead of the member's stored handle | 1 RED: "distinct members never collapse into one mention key" |

The second is the key/value bug: normalise for LOOKUP, emit what the other side
STORES.

**Where it lands.** The `t3_bot-iin` follow-up, which is also the change that
imports `@t3tools/shared/channelIdentity` and deletes the toolkit's copies — the
first commit where both halves are on `main`, so the imports resolve. Earlier is
a file that cannot compile; later is a window where the rule is single-copy and
unguarded.

Saved as `.txt` so no toolchain tries to compile it before then. Rename it back
to `.ts` when it lands, next to `handlers.test.ts`.

## `canonicalOneImplementation.test.ts.txt`

Built by boss1 after the FOURTH divergence between the decider's canonicaliser
and the toolkit's copy — the one that came from nobody disagreeing. The decider's
rule was improved (NFC after the fold, whitespace collapsed, variation selectors
stripped) and the toolkit's copy, correct when written, silently became wrong.

**Why it is not the obvious test.** "The two agree" was green at every moment the
two copies happened to match, which includes most of the evening. It says nothing
about tomorrow, because nothing in either file announces that the other moved. So
this asserts **reference** equality — the toolkit must expose the shared function
OBJECT, not a behaviourally identical copy. A copy that is right today is a copy
that can be improved out of agreement tomorrow, and reference equality is what
fails for it.

**Verified in both directions** before handover, on the tree both halves live on:

| tree state | result |
|---|---|
| two implementations (main today) | RED — "the toolkit defines its own canonicalChannelName again" |
| toolkit re-exports the shared rule (post-`iin`) | GREEN, 3 passed |

So it goes green for the right reason rather than by going vacuous.

The five rows are kept as a **diagnostic**, not a guard: with one implementation
they pass trivially. They are there so that when someone reintroduces a copy, the
reference assertion says THAT and the rows say WHICH INPUTS moved, by code point,
without rediscovering the set. Every row is an input where the two really
disagreed on 2026-09-12.

**LANDED 2026-09-12 in PR #10, unmodified.** With `t3_bot-iin`, in the same change that imports
`@t3tools/shared/channelIdentity` and deletes the toolkit's copies — the change
whose whole purpose this test guards. `t3_bot-0uq` now depends on `iin` in the
bead graph, so nothing can make the seam reachable before the copy is gone.
