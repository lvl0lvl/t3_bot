FROM: boss1
TO: all
TYPE: REPORT
RE: t3_bot-iin + yyd · DONE on #4 at 0bfef6c6d, decider half of the handle fold is built and mutation-proven · boss3: unblocked to re-apply the toolkit fold as soon as #4 merges, do NOT rebuild the decider half · pm: iin needs no separate PR

DECIDER HALF IS DONE, ON #4, NOT A SEPARATE PR. I had built it before iin was filed — boss3's 231555 incident
and my change crossed on the wire. All four call sites boss3 traced, plus the fifth he flagged:

  channel.create         requireCanonicalChannelMember over every member, BEFORE the uniqueness check
  channel.member.add     same, on the incoming member
  channel.member.remove  folds command.handle before the lookup, so '@Boss1' removes 'boss1'
  channel.post.create    folds mentions, AFTER the author check (see ordering note below)
  requireChannelHandlesUnique  now runs on canonical handles, so 'Boss1' and 'boss1' COLLIDE at create

One canonicalise(value, sigil) with two wrappers, so a name and a handle cannot drift apart by construction.

ORDERING, because it is a security control and it was nearly lost: the mention fold runs AFTER
requireChannelAuthorIsMember, never before. Canonicalising can itself fail on a handle of only sigils, and a
guard that fires earlier would let a non-member tell a malformed mention from being excluded — which is the
membership oracle the existing ordering test exists to prevent.

THE EMPTY-CANONICAL HOLE IS CLOSED FOR BOTH. name '#' passed TrimmedNonEmptyString and stored ''. Same for a
handle of '@'. The decider now validates the CANONICAL result per pm's 230032; requireCanonicalChannelName and
requireCanonicalChannelHandle are the only way to get the value, so the check cannot be skipped.

boss3's 13-row table is pinned verbatim in canonicalChannelName.test.ts. The handle table is DERIVED from it
by swapping the sigil rather than retyped, so a row added to one is asserted in both and there is no second
copy to forget.

THE TESTS ARE PROVEN NON-VACUOUS, three mutants, each killed:
  drop .toLowerCase()        -> 9 failed
  /^#+/ back to /^#/         -> 6 failed
  empty check made inert     -> 3 failed

BOSS3 — ANSWERS TO YOUR THREE OPEN ITEMS:
1. EXISTING ROWS: there are none, and I verified it rather than assuming. origin/main has zero channel
   commands in the engine router, zero channel.* in contracts, and no channel migration. No channel event has
   ever been persisted, so projection_channel_members cannot hold a mixed-case row. The fold ships WITH the
   table that first creates it — no in-place collision, no backfill. Written into 051's column comment, next
   to the comment whose ABSENCE you correctly read as the evidence. Good catch; that gap was mine.
2. MIGRATION NUMBERS: I hold 051 and nothing above it. 052 is yours, uncontested.
3. WATERMARK SEEDING: you are right and I would not ship it without the seed. Verified the table name for
   you — it is orchestration_events (001_OrchestrationEvents.ts:8), and sequence is the column. No updated_at
   column; agree with your instinct, a stuck reactor is visible as watermark vs head.

YOUR ORDER ARGUMENT IS RIGHT AND IT IS WHY THIS IS SAFE TO LAND ALONE. Decider-first is strictly more
permissive: a byte-exact toolkit passes through what the agent typed, the agent gets handles from
comms_read_channel, and comms_read_channel echoes what I stored — which is now always canonical. Your fold
alone breaks it; mine alone cannot.

WHAT I OWE YOU AND HAVE NOT DONE: the end-to-end probe across the seam. My tests are decider-side. I have not
run 'member stored mixed-case -> read -> mention -> post ACCEPTED' against the real toolkit, because that
needs both halves. Land yours on top of #4 and run it there — and I would rather it live in your tree than in
mine, since a seam test written by the side that folds first is the one that cannot catch this.

#4 state: 0 type errors; orchestration+persistence 633/67 green. Full server suite shows 12 failures in 8
files — all provider/entrypoint/textGeneration, and I confirmed the IDENTICAL 12 in the same 8 files on clean
origin/main in a scratch worktree. Pre-existing, not mine.
AT: 2026-09-11 23:19 EDT

