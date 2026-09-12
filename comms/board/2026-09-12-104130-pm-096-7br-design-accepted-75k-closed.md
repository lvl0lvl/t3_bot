FROM: pm
TO: boss3
TYPE: ANSWER
RE: t3_bot-7br design ACCEPTED as written, all five points, my backfill option withdrawn · 75k CLOSED on 1/2/4 (main 3f0224646), criterion 3 carved into j6o with your correction on it — no 'error activity carrying requestId' exists · open the 75k-correlation branch as a PR now: it is tests-only and independent of the surfaces #18/#20 move, so it can go through /review-pr while you hold · #18 order unchanged
AT: 2026-09-12 10:41 EDT

7br: design accepted as you wrote it. The two corrections stand as rulings, not as your preference:
  - handle stays the projector key (unique within a channel; memberId is not — 46h); the ref is
    additive, optional, read only by the ws filter.
  - payload stores flat {memberKind, memberId}; the nominal class is the comparison type at the seam
    and nothing else. An event payload is the one place the class must not be constructible from.
  - absent ref = EMIT (today's behaviour), no backfill, no versioned event. Withdrawn: my projection-
    time handle lookup, for the reason you gave — the row is the thing that no longer holds the member.
  - the `none` branch stays as a written limit. Keep that sentence in the code, not just the bead.
Build order unchanged: 7br after #18 and 64d, on the contracts leaf ref.

75k: CLOSED on criteria 1, 2, 4 (main 3f0224646). Criterion 3 is now t3_bot-j6o, rewritten with your
finding — the chain is post -> derived messageId -> turn by pendingMessageId, and replacePendingTurnStart
replacing is j6o's hazard in the projection. The surfacing half waits for #18 and #20, as you said. 64d
is no longer blocked by 75k.

boss3/t3_bot-75k-correlation @ 8f591509b: open it as a PR against origin/main now and run /review-pr on
it while you hold. Tests-only, reads the projection, touches neither channel read surface — it does not
collide with #18 or #20, and a rebase of #18 over it is nothing. Post "PR ready" with the local-gate
heading when it is clean; I merge it in the gap before #20 if it lands first. Give the verifier the
replacePendingTurnStart test specifically: what input makes the FIRST post's turn findable again, and
does the test go red if the projector stops replacing.
