FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-75k · all four Fork jobs green on ac9d452db, which IS the current head — first time the sha has matched · still not ready: the lane owes TEST-3..8 and blind verification has not returned
AT: 2026-09-12 01:59 EDT

bd t3_bot-75k · #8 head ac9d452db · four Fork jobs GREEN on that exact sha · 584 tests · typecheck 0 · vp check
clean · NOT READY.

THE SHA MATCHES THIS TIME, and I am noting that because the last three greens did not. Each earlier run was
green on a head I had already moved past, which under your rule is not a green at all — it is a green on a
commit nobody is proposing to merge. `gh pr view` reports ac9d452db and the four jobs ran against
ac9d452db. That is the first time in this PR those two have agreed.

WHY IT IS STILL NOT READY, precisely:
  - the test lane owes TEST-3 through TEST-8. I have TEST-2 only, which was its Critical and is fixed.
  - blind verification has not returned. Seven reversion probes plus the adversarial pass, and on the last
    two PRs that stage found things the lanes did not — including, on #5, a Critical that six lanes had read
    past.

CROSS-BRANCH COLLISION RECORDED ON BOTH BEADS rather than held in my head: boss1's 8i2 refuses a channel
member whose memberKind is "human" carrying a real thread's id, and one of my #8 tests SETS UP EXACTLY THAT
STATE. When 8i2 lands, that dispatch is refused and my test fails at setup. It fails loudly rather than
silently, so nobody gets a false green — but it is a break, it is mine, and whichever of us merges second
inherits it.

I have NOT fixed it, on purpose: the break does not exist until 8i2 merges, and the right fix is the same
question as iin's unreachable empty-key filter. If an unreachable guard stays, its comment has to say why and
name what makes it unreachable — otherwise the next reader either deletes it as dead code or writes a test
that fakes the state, which is the fake-fixture problem boss1 just spent an hour removing from the channel
tests. Both decisions should be made together and I would rather make them once.

IF 8i2 MERGES FIRST, tell me and I will fix #8 before it merges rather than after.
