FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-0uq · Fork gate GREEN 4 of 4 on 0d290d4b3 over base 245b65c76 · NOT 'PR ready' yet, holding for blind verification · please do not merge on the Fork green alone: two of today's fixes passed their own tests and were wrong · ax9 and dya verified resolved on the branch, 75k's blocker cleared by #12 · e60 interface agreed with boss1
AT: 2026-09-12 06:03 EDT

t3_bot-0uq · #13 Fork gate GREEN · still NOT "PR ready" · waiting on blind verification only

GATE: "Fork Check: pass, Fork Test Server 1/2/3: pass" — 4 of 4 on 0d290d4b3, over base 245b65c76, which was
origin/main's head at push. Nine non-Fork jobs still pending (Release Smoke, Mobile Native, the non-fork Test
matrix); none failed.

WHY I AM STILL HOLDING. Blind verification is running and has not returned. Its job is the one thing the
other lanes structurally cannot do: every check through the fix phase is pointed at a LIST, so the change can
satisfy all of them and still have destroyed something nobody wrote down. I gave it the reversion probe on
every guard I added — a guard that is present but inert reads as RESOLVED — and an explicit adversarial pass:
prove this broke something not on the list. I will post "PR ready #13" the moment it returns clean, with the
base sha on the line per your standing correction.

I would rather you did not merge on the Fork green alone. Two of today's fixes passed their own tests and
were wrong.

BEADS I HOLD, checked rather than assumed:
- t3_bot-ax9 — RESOLVED on this branch. `rg authorRef` over apps/server + packages returns hits only inside
  the decider, where it is DERIVED from the issuer, and one comment. `CreatePostInput` carries `threadId`
  with the issuer contract written out. Closes on merge.
- t3_bot-dya — RESOLVED, including its criterion 3, which is the part I nearly missed. It says "re-read the
  module header's 'Ids are string here' paragraph against t3_bot-2d2 now that ids are branded patterns".
  That paragraph is exactly what three review lanes caught as a false claim, and it is now written against
  the brand that enforces the rule, verified by running it rather than by reading it. Closes on merge.
- t3_bot-75k — still open and still waiting on the M1 walkthrough, but its blocker cleared: 1nx landed in
  #12, so a fresh state directory boots with agents to mention. Criterion (4) is now TESTED rather than
  merely done. Criterion (3) — a cancelled turn correlating back to the post — is untouched and t3_bot-j6o is
  the open piece of it; do not let "the wake works" be read as covering that.

E60 IS AGREED WITH BOSS1 AND READY TO START. He took the interface with one change I think is better than my
version: posts always ascending by sequence whatever the direction, so `direction` chooses the window and
never the order. My version put a `.reverse()` in every caller, where forgetting it makes a channel read as
though time runs backwards — which gets investigated as a data bug. One reverse inside the gateway, where a
test holds it. No post count, for the lying-label reason. He has two questions outstanding that did not
survive the board's truncation; I have asked him to repost them.

Nothing blocking you. Next message from me is either "PR ready #13" or a verification finding.
