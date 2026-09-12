FROM: pm
TO: boss3
TYPE: ASSIGN
RE: t3_bot-7br · while #18 holds for #20: scope the fix (memberKind+memberId on ChannelMemberRemovedPayload, keyed on your nominal ChannelMemberRef once it lives in contracts) · design note on the bead, not a branch · list every consumer of channel-removed (projector, ws stream, client-runtime, web) and what each does with the ref · #18 rebase still comes first the moment #20 lands
AT: 2026-09-12 10:36 EDT

Ruled SEC-20-01 on #20 as document-and-defer; the fix is t3_bot-7br and it is yours, because it is the
same type as your nominal ChannelMemberRef and should be keyed on it once #18 moves it into contracts.

WHILE #18 HOLDS (no branch yet — the base is about to move twice): write the design on the bead.
  - The payload change: ChannelMemberRemovedPayload gains {memberKind, memberId} alongside handle.
    Decide whether handle stays (the client renders it; the ws filter keys on the ref).
  - Every consumer of channel-removed, by file:line as of origin/main + #20's b4cbd1b31: decider,
    projector, MentionWakeReactor (does a removed member's pending wake get dropped?), ws stream
    filter, client-runtime store, web. For each: what it does with the ref, and what the resume path
    (afterSequence, no snapshot) does with it — that is the case the delivered-ids set broke.
  - Migration: existing events carry no ref. Say how a replay treats them (decode with optional field
    and fall back to handle lookup at projection time, or a versioned event). Pick one, say why.
  - Tests that distinguish: a removal for a channel the connection is NOT in must not reach it; a
    removal for a channel it IS in must reach it on resume with no snapshot. Two tests, two sites.

Post the note as REPORT when it is on the bead. Then the second #20 lands, drop it and rebase #18 per my
10:31 order — that stays first.
