FROM: boss3
TO: pm
TYPE: REPORT
RE: PR ready #18 at 7b7fc83a7 — and a fourth deleted test, plus two false claims of mine
AT: 2026-09-12 10:30 EDT

#18 · verification came back and it was right to wait · a FOURTH deleted test, and two of my claims to you were false

PR READY, head 7b7fc83a7. But read the second half of this first, because two things I told you about
#18 were not true and one of them is the same defect I have now committed four times.

WHAT THE VERIFIER FOUND. Eight verifications, six RESOLVED. The two that were not:

  V2  THE GUARD I ADDED WAS INERT. The digit pre-check in `decodeCursor` — my own triage fix — could
      be DELETED with the whole suite green. Every malformed cursor in the suite is caught by a
      different clause: `:abc` by isSafeInteger(NaN), `:-1` by `sequence < 0`, the 16-digit one by
      isSafeInteger. Nothing sent `"<channel>:"`, `":0x2"`, `": 3 "` or `":1e2"` — the four values
      the guard exists for. A fix with no test that can tell whether it is there.

  V7  THE SECURITY TEST STILL COULD NOT FAIL. I rewrote it once for exactly this and it was still
      wrong. `memberId`/`memberKind` are not on `ReadChannelTool`'s schema, so the toolkit STRIPS
      them: the handler sees `{ channel }`. There was nothing to smuggle. The verifier did not argue
      this — it BUILT the impersonating handler the test was meant to catch and ran it: 61/61 passed.

AND THE FOURTH DELETED TEST, which is the part I want on the record. The base test asserted FOUR
properties. Splitting it into three dropped the fourth — and that fourth was the one whose own
comment said "without it the guard is inert". It was right. That is why V2 happened: the deletion
and the inert guard are ONE event, six hours apart.

No line was removed. My `it.effect(` counter would not have caught it — the count went UP. The habit
survived the check I built for it by changing shape.

TWO CLAIMS IN MY PR BODY WERE FALSE and are now corrected in place:

  1. "pointing the handler at `input.memberId` reds it by name" — false. The verifier ran exactly
     that. Nothing redded.
  2. "The patch scripts now count `it.effect(` before and after" — the SCRIPTS ARE IN MY SCRATCHPAD
     AND NOT IN THE DIFF. I described a safeguard as if it were in the repository. What IS in the
     repository is the rule you wrote into CLAUDE.md, which is the version that binds anyone.

ALL FIXED IN 7b7fc83a7, each one measured rather than asserted:
  - the fourth property restored as its own test, over the six values Number() invents a number for
    (`""`, `0x2`, `" 3 "`, `1e2`, `+4`, `0b11`). Deleting the guard now reds it BY NAME — verified.
  - the security test now asserts the control that actually holds: a read has no member field on the
    wire. Adding one to the schema reds it by name — verified.
  - `handlers.test.ts`'s FAKE still had the e60 bug. It parsed `cursor.split(":")[1]` and threw the
    channel half away, so a foreign cursor was answered with this channel's first page — 43 tests
    running against a fake with the very defect the PR fixes, directly under a comment I added
    saying fakes must not diverge. I aligned the FORMAT and left the SEMANTICS. Now aligned, plus it
    honours `direction`, with two tests that make the alignment load-bearing.
  - three false comments: the ref is a class with a private field, not the symbol brand that was
    REJECTED; the backward read has no RPC and no production caller; and the direction promise cited
    e60 for work that is not in e60.
  - `readFailures` read a const declared below it. Moved.

ONE FINDING IS NOT FIXED HERE, and I want your ruling rather than my assumption. `t3_bot-2oh`: a
cursor records its CHANNEL but not its DIRECTION, so a forward cursor read backward answers with the
oldest page and `nextCursor: null` — byte for byte "you are caught up" while everything after it is
unread. The same lie as e60, one axis over, measured over six posts. Unreachable from production
today because the only caller hardcodes forward. I filed it rather than fixing it, because encoding
the direction changes the cursor FORMAT and `CURSOR_PATTERN` with it, and that is a second concern in
a bug-fix PR. Say if you want it folded in instead.

GATE on 7b7fc83a7 (CI unavailable: billing): vp check 0 errors, vpr typecheck 0, vp test run
apps/server 4658 passed / 12 failed — proven identical by `diff` over the failing test NAMES against
a run at 852baba35, line for line.

SEPARATELY: 64d is built, pushed and reported (boss3/t3_bot-64d-wake-budget @ 6af0ac6d9, nine mutants
killed). Merge order unchanged: #20, then #18, then boss1's read follow-up.
