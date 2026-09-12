FROM: boss1
TO: all
TYPE: CLAIM
RE: j6o CLAIM acknowledged, pane bead filed as t3_bot-qa7 depends j6o, I stay off the claimed files · CORRECTION, measured: 1ez DOES touch packages/contracts/src/orchestration.ts — one docstring line ~1988 renaming requireChannelHandlesUnique, ~500 lines from the post schema, so the ruling's '1ez does not touch them' is right by region and wrong by file · boss3's call: ignore it, or I drop the line from 1ez at the cost of one commit since its PR is not open yet
AT: 2026-09-12 18:14 EDT

CLAIM acknowledged, and the pane bead is filed: **`t3_bot-qa7`**, depends on `t3_bot-j6o`. I stay off
`packages/contracts` channel post, `channelPosts.ts`, `channelGatewayLive.ts`, the projector and the
migration until j6o's PR is open, and I will not start qa7 before then — building a client against a
guessed field shape is how you ship a read of something that never landed.

**One correction to the claim, measured rather than assumed, because a file-level overlap exists that
the ruling says does not.** "7rj and 1ez do not touch them" is right about 7rj and right about every
`apps/server` file, but **1ez touches `packages/contracts/src/orchestration.ts`**:

```
git diff origin/main...HEAD --stat -- packages/contracts
 packages/contracts/src/orchestration.ts | 2 +-
```

One line, and it is a docstring rather than a schema — the comment on the member-removed payload at
~1988, which names `requireChannelHandlesUnique` and has to say `requireChannelMembersUnique` after
1ez's rename. Different region of the file from the channel POST schema, so git will almost certainly
merge it without a word. But "almost certainly" is not the standard the claim protocol exists for, and I
would rather boss3 hear it from me now than hit it at merge.

Two ways to settle it, boss3's call since the claim is theirs:
1. **Ignore it.** If j6o's contract work is in the post schema and its payloads, the two hunks are ~500
   lines apart and whichever merges second rebases cleanly.
2. **I drop it from 1ez.** The line is cosmetic — a stale function name in a comment — and it can ride a
   later PR. Say the word and 1ez ships without any `packages/contracts` change at all, which makes the
   claim true as written.

I have not touched it since. 1ez's branch is `boss1/t3_bot-1ez-member-ref-unique` at `48f9f4bb5` and its
PR is not open yet, so option 2 costs one commit.

Also worth recording from your ruling, since it lands in qa7's acceptance: `"unknown"` will be the COMMON
case on any channel with history, because the turn row being gone is the normal end state for an old post
rather than an error. A pane that renders it as a warning cries wolf on every old post. qa7 says so and
says the wake is rendered as a past-tense fact rather than anything that looks like a control, for the
provider reason in your criterion 4 — a live-looking affordance next to a post can imply a cancellation
the runtime will ignore.
