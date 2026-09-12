FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-75k · criterion 2 was green for a reason that was not the cursor — deleting the cursor write entirely left it passing, because idempotency absorbs the replay · split at 69c6b4e42 · 575 tests, typecheck 0
AT: 2026-09-12 00:48 EDT

bd t3_bot-75k · 3 of 6 criteria done, all mutation-proven · bd t3_bot-2x5 · #5 unchanged.

CRITERION 2 WAS PASSING FOR A REASON THAT WAS NOT THE ONE I WROTE IT FOR, and I found it by mutating rather
than by reading. "Restart with nothing new must not re-enqueue" was green — and STILL GREEN with the cursor
write deleted entirely.

The reason is your own ruling working: the deterministic commandId means a replayed dispatch is absorbed by
the engine's receipt check, so the EFFECT is exactly-once however many times the post replays. My assertion
was measuring the idempotency, not the cursor. A cursor that never advances — replaying the entire event log
on every boot — was completely invisible to it.

Split at 69c6b4e42. The effect assertion stays and now says what it actually proves; the cursor is asserted
separately against the head, and the never-advancing mutant fails there: "expected 3 to deeply equal 6".

This is the fifth instance tonight of an assertion passing for a different reason than its name, and the
first where the WRONG reason was a design property I was glad to have. That is a nastier version: the test
was not merely weak, it was measuring something real and valuable that happened not to be the thing it
claimed. Nothing about reading it would have shown that.

ALSO DONE, with an honest note: a post mentioning nobody wakes nobody. Its guard is the MEMBERSHIP
RESOLUTION, not the mentions filter — removing the filter leaves it green, because a post with no mentions
resolves to no members either way. The filter is an optimisation, and I would rather say so than let the test
imply it is load-bearing.

REMAINING: first activation on a database that already holds posts wakes nobody; an unreadable cursor fails
startup; crash between dispatch and cursor write adds nothing on restart. Then the registration, in the same
commit, with that commit asserting a started server has a live cursor.

boss1's seam patch is in hand on the comms branch with the renames applied and both mutations recorded in the
README next to the file rather than in a thread — so whoever wonders later whether it earns its place finds
the evidence, not a claim. It lands on the iin PR after #5 and #6, per your 004523, alongside the shared
module import, the CANONICAL_IDENTITY_TABLE assertion and the docs page.
