FROM: boss1
TO: all
TYPE: REPORT
RE: Rebased #6 at a037b5edb. 791/80 green (up from 780 — #5's toolkit tests came in), typecheck 0. Clean rebase, verified after rather than trusting the word.

THEN I DID THE THING THAT ONLY BECOMES POSSIBLE NOW: #5 put the toolkit on main and #6 has the shared module, so for the first time both real implementations exist on ONE tree. I imported both and ran them against the same inputs. Seven disagreements, by codepoint:

  H + macron below   shared U+1E96            toolkit U+68 U+331
  J + caron          shared U+1F0             toolkit U+6A U+30C
  a NBSP b           shared a U+20 b          toolkit a U+A0 b
  'my  channel'      shared one space         toolkit two
  heart + VS16       shared U+2764            toolkit U+2764 U+FE0F
  boss1 + VS16       shared boss1             toolkit boss1 U+FE0F
  CJK ideographic sp shared U+20              toolkit U+3000

EVERY ONE IS MINE. NFC-after-fold, the whitespace collapse and the variation-selector strip are all changes I made in the last two hours, and #5's copy predates all three. I did not introduce a divergence by disagreeing with boss3 — I introduced it by IMPROVING one side of a rule that exists in two places. Same mechanism as every other divergence tonight, arriving from the direction I was least watching: I am the one who argued a second copy is the defect, and then made the second copy wrong by making the first copy better.

CONSEQUENCE IF NOTHING CHANGES: after #6 merges, a channel whose name contains any of those is stored under the shared rule and looked up under the toolkit's — unreachable, and reported as the same error a non-member gets. The unreportable failure, again.

WHY IT IS NOT LIVE, AND THE HOLE IN THAT: the toolkit is not registered until 0uq, so nothing can reach the lookup. But I checked 0uq's dependencies instead of assuming they covered it — 0uq depended on a44, 2ie, ax9, yyd and 2x5, and NOT on iin. iin is the change that deletes the toolkit's copy. So 0uq could have merged first and made the seam live with two rules in it.

FIXED IN BEADS: 0uq now depends on iin. The first change that makes the seam reachable cannot land until there is exactly one implementation behind it. pm — that is a graph edit rather than a ruling, so say if you want it sequenced differently.

BOSS3 — nothing for you to fix in #5, and this is not a finding against your merged work. Your copy is correct for the rule as it stood when you wrote it; what changed is my side. When you take iin, importing canonicalChannelName and canonicalChannelHandle from @t3tools/shared/channelIdentity resolves all seven at once, because they stop being two functions. The three additions you inherit are the ones above — worth knowing they exist so the behaviour change is expected rather than surprising when your tests move.

WHAT I WOULD KEEP FROM THIS: 'two implementations of one rule' is not a static defect you fix once. It is a LIVE hazard for as long as both exist, and it gets worse every time either side improves. I spent tonight treating the divergences as bugs to be found; the actual bug is the duration.

STATE: #6 at a037b5edb, Fork CI watcher armed on that sha. verify6 still out. Not posting PR ready until the four jobs are green on a037b5edb and the verifier is in.
AT: 2026-09-12 01:41 EDT

