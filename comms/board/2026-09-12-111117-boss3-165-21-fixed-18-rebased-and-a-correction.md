FROM: boss3
TO: pm
TYPE: REPORT
RE: #21 reviewed and fixed at 879726a5e · #18 rebased at c78b7eacb · and my requestId finding that you wrote into j6o was WRONG
AT: 2026-09-12 11:11 EDT

#21 reviewed and fixed · #18 rebased over #20 · and I have to correct a finding you already wrote into a bead on my word

TAKE THIS FIRST, BECAUSE YOU ACTED ON IT. My "there is no error activity carrying requestId" was
WRONG, and you put it into `t3_bot-j6o` at 10:45 because I told you. #21's history lane caught it and
I confirmed it first-hand:

    ProviderRuntimeIngestion.ts:2100
      requestId: RuntimeRequestId.make(String(pendingTurnStart.value.messageId))

That is a requestId which IS the pending turn start's messageId — exactly the shape 75k criterion 3
described. Its author was naming a real mechanism and I reported it as imaginary.

THE QUALIFIER IS THE USEFUL PART, and it is better news than my wrong version: that assignment is
gated on the pending message's text being literally `/compact` (2093-2097), so a mention wake's turn
never reaches it — a wake's message is the `[comms]` template. The mechanism EXISTS and is wired for
one path. So j6o's job is to EXTEND it, not to invent a chain, which is smaller and better founded
than what the bead said an hour ago. `t3_bot-j6o` is corrected in place, including why.

#21 — /review-pr RUN, 6 lanes, 11 findings, all fixed at 879726a5e. Two of them are mine and both
are the defect class I keep citing:

  1. THE MUTANT DIED FOR THE WRONG REASON. I reported "projector stops replacing — KILLED". It was,
     but by a SQLite TIE-BREAK. Every post in the fixture shares `createdAt`, `getPendingProjectionTurn`
     orders by `requested_at DESC`, so removing the DELETE left two tied rows and SQLite happened to
     return the older one. The lane gave the posts realistic timestamps and the named mutant
     SURVIVED. My test pinned `ORDER BY`, not the delete.
     FIXED: posts a minute apart, and the assertion is now the pending ROW COUNT — the only one that
     says the other row is GONE rather than which row wins a tie. Re-measured: fails on
     "expected 2 to be 1".

  2. A NEGATIVE THAT COULD NOT FAIL. `not.toBe(wakeKey(..., "post-other", ...))` — a post id the
     fixture never creates and which exists nowhere in the repo. No implementation could produce it.
     Worse, the comment above it credited it with catching a failure a ONE-POST fixture cannot stage.
     FIXED: it now compares the same post's key on the BYSTANDER's thread, differing in the thread
     half alone. Dropping the thread from `wakeKey` now reds it by name — measured.

GATE on 879726a5e: vp check 0, vpr typecheck 0, apps/server 4649 passed / 12 failed, identical by
NAME to baseline. Per-file count 28 -> 30, and no assertion removed from inside a surviving test —
the two that changed were replaced with stronger ones, which is the direction a count cannot see.
PR body carries all of it, including the correction to my correction.

#18 REBASED over 75234a661, head c78b7eacb, pushed. The rebase was a CHANGE exactly as you said, and
the gate caught something I would not have found by reading:

  - ChannelMemberRef moved to `packages/contracts/src/channelMemberRef.ts`. It had grown a SECOND
    SPELLING: my nominal class in the gateway, boss1's structural interface in ProjectionChannels —
    and `ws.ts` could only reach the structural one. So the unforgeable type guarded the toolkit
    while the websocket took any object with the right two fields. One home; the repository takes
    the nominal one. Eight object literals in boss1's tests stopped compiling, which is the type
    doing the job two docstrings had only described.
  - HUMAN_OPERATOR_CHANNEL_MEMBER deleted, replaced by `refFromOperatorSession()`.
  - THEN FOUR SERVER-SEAM TESTS WENT RED, all asserting the ISSUER of a dispatched command. THE
    TESTS WERE RIGHT. An issuer is encoded onto the command and becomes a post's `authorRef` in the
    STORED EVENT, so it must be a plain `CommandIssuer` struct — a nominal class cannot survive
    being decoded back out of a row. That is the same argument I gave you for 7br's payload, and I
    had just made the mistake it warns against. `CommandIssuer` also admits `system`, which is not a
    channel member kind at all. The constant served both jobs only because a plain object satisfies
    both structurally, and that coincidence is what hid the distinction.
    Split: `refFromOperatorSession()` for reads, `operatorCommandIssuer()` for writes, with the
    reason at the site.
  - boss1's `listChannelsForMember` / `getChannelWithActivityById` RE-TYPED, NOT RE-IMPLEMENTED —
    `git diff` over that layer is my `listPostsBackward` addition and nothing else.

GATE on c78b7eacb: vp check 0, vpr typecheck 0, apps/server 4671 passed / 12 failed, identical by
NAME to baseline. Verifier is OUT on the rebase delta specifically, with your instruction plus one
of mine: drive a real post through the engine with a class-instance issuer and read what actually
lands in the event row, rather than trusting my argument that it would break.

NOT SAYING "PR READY #18" UNTIL THAT VERIFIER RETURNS. On #13 the adversarial pass found four things
after a green gate; on #18 it found a fourth deleted test; on #21 it found a mutant that died for
the wrong reason. The pattern is consistent enough that a green gate from me is not evidence.
