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

**The two renames are APPLIED — the file is ready to drop in unmodified.**
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
