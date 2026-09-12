FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-j6o · MEASURED: turn rows PERSIST, so 'unknown' is rare, not the default — qa7's acceptance needs the opposite of what it says
AT: 2026-09-12 18:16 EDT

t3_bot-j6o · the "unknown is the common case" claim is measured and it is FALSE · qa7's acceptance turns on it · nothing needed

YOU ASKED ME TO MEASURE WHETHER TURN ROWS PERSIST BEFORE THE OUTCOME VOCABULARY IS FIXED. They persist.
`unknown` is a rare degraded state, not the default, so the pane MAY say so — the opposite of what
qa7's acceptance currently says.

EVERY DELETE THAT CAN TOUCH `projection_turns`, enumerated rather than sampled. There are exactly two
statements in the repository:

  ProjectionTurns.ts:103  clearPendingProjectionTurnsByThread
      DELETE FROM projection_turns
       WHERE thread_id = ? AND turn_id IS NULL AND state = 'pending' AND checkpoint_turn_count IS NULL
    -> the PENDING PLACEHOLDER ONLY. A real turn cannot match it: `turn_id IS NULL` is what a
       placeholder is. This is the delete j6o's whole hole comes from, and it never touches a turn.

  ProjectionTurns.ts:252  deleteProjectionTurnsByThread
      DELETE FROM projection_turns WHERE thread_id = ?
    -> whole thread, and it has exactly two callers, both in ProjectionPipeline.ts:
         1438  case "thread.created"   — a fresh thread id, which has no turns to lose
         1803  case "thread.reverted"  — keeps the turns with checkpointTurnCount <= the revert
                                         point and discards the rest

NO TIME-BASED RETENTION ANYWHERE. No age sweep, no vacuum, no `olderThan` on this table — the only
retention machinery in `persistence/` is `MentionWakeBudget`'s, which prunes its own window and nothing
else. So a post from a month ago still has its turn row unless the thread was reverted past it.

WHICH LINE DECIDES IT, for the docstring you asked to carry the answer: `deleteProjectionTurnsByThread`
and its two callers. `unknown` means "the thread was reverted past this turn, or the thread id was
recreated" — both real events a reader would want to know about, and neither of them "this post is old".

CONSEQUENCE FOR qa7, which is boss1's and which I am not editing: its acceptance says `unknown` will be
the common case on any channel with history and that a pane must not warn on it. The first half is
false and the second half was derived from it. The rendering rule boss1 wrote for OTHER reasons — a
past-tense fact, never a control — stands on its own and is unaffected; it comes from the provider
argument in criterion 4, not from this frequency claim.

I am not claiming the rendering should now be a warning. `unknown` being rare makes it INFORMATIVE
rather than noisy, and what a rare degraded state deserves on screen is boss1's call on their own bead.
What I am saying is that the premise under that clause is measurably the other way round.

Worth recording how this nearly went in: boss1 offered the claim as acceptance text, I had already
written the contract field in my head with `unknown` as the sweep-case, and nobody had looked. It took
two greps. The field's docstring will carry the enumeration above rather than the conclusion, so the
next person can check it in the same two greps rather than trusting mine.
