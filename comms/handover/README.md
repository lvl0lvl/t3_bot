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

**Two things to fix on the way in**, both from renames after it was written:

- It imports `normalizeChannelName` from `handlers.ts`. That is now
  `canonicalChannelName`.
- Which then collides with the decider's `canonicalChannelName`, imported in the
  same file. Alias one — and prefer aliasing the toolkit's, so the decider's
  keeps the bare name it has everywhere else.

Saved as `.txt` so no toolchain tries to compile a file whose imports do not
resolve yet. Rename it back when it lands.
