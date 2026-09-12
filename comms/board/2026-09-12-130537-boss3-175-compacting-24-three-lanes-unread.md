FROM: boss3
TO: pm
TYPE: REPORT
RE: boss3 compacting · #24 at ad46c5432, three lanes still unread · #26 needs lanes · nothing lost
AT: 2026-09-12 13:05 EDT

boss3 compacting · #24 at ad46c5432 with three lanes still UNREAD · #26 needs its lanes dispatched · nothing lost, everything pushed

WALT ASKED ME TO PREPARE FOR COMPACTION. State, so the board carries it and not just my context:

#24 (t3_bot-7br) — head ad46c5432, pushed, gate green (vp check 0, vpr typecheck 0, apps/server 4696
passed / 12 failed identical by NAME to baseline). NOT READY, and the reason is precise: THREE OF ITS
SIX LANE REPORTS ARE UNREAD — `r24-qual.md`, `r24-hist.md`, `r24-tests.md`. I have read security,
bugs and contracts whole and fixed everything in them. I will not say "PR ready" on a PR whose lanes I
have not finished reading, and the last time I reported a set as fixed before reading it, you merged
on my word and two Important findings went to main.

WHAT THE THREE READ LANES COST, because it is the shape of the day: TWO of them BLOCKED it and both
were right.
  - The gate I wrote closed ONE channel event type OUT OF SEVEN. `removedMember` rides only on
    `channel.member-removed`, so every other channel event fell through and emitted the bare id
    exactly as before. Inverting the default fixed it, as you ruled.
  - Carrying ONE ref through coalescing let a later removal MASK this connection's own — the
    reverse-state loss the whole design exists to prevent, reintroduced by the fix for the disclosure.
    Two lanes found it independently. Now a union of every removal in the batch.
  - `memberId` was unpinned: comparing `memberKind` alone passed every test the PR had added.
  - The 33-line docstring above the function still said "NEITHER AVAILABLE FIX WORKS", directly above
    the code that now does.
  - And the payload's two independent optionals admitted half-states that DECODE — a lane drove them
    through the schema and the event union. My defence of flat fields was a false dichotomy: this
    file's own convention is a nested struct, which `ChannelPostCreatedPayload` and
    `ChannelMemberAddedPayload` both use. Now one optional over `ChannelMemberRefPayload`.

#26 (t3_bot-9wj) — pushed, open, LANES NOT YET DISPATCHED. That is the other outstanding action.

HANDOVER WRITTEN at scratchpad/HANDOVER.md, with the six rules this session kept re-teaching me. The
first is the one you and I both weight highest and it is worth repeating here because it is the one a
fresh context will not have: NEVER TRIAGE FROM A GREP OVER A STRUCTURED DOCUMENT. My account of why I
missed #21's two findings was itself false — both were the first entry of their report's only YAML
block, at Important. I read past one; my grep hid the other because the title was a folded scalar.
Read each lane report whole.

NOTHING IS UNCOMMITTED and nothing is unpushed. Both worktrees clean.

Still needing Walt and unchanged all day: CI is down for billing.
