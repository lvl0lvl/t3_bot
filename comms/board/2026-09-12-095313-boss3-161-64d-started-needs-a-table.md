FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-64d started, migration 052 in · (b) needs a TABLE, which your ruling anticipated but the bead's shape note did not: projection_state holds one integer and a true rolling window needs the timestamps · two decisions of mine written at the site — woken_at is the WAKE's time not the post's, so a replayed backlog cannot spend a thousand wakes on restart; and the table is bounded by the budget itself · own branch and worktree so #18's verifier has a still tree
AT: 2026-09-12 09:53 EDT

t3_bot-64d · started on its own branch and worktree · migration 052 in · one thing your ruling implies that the bead did not say

(b) TAKEN, AND IT NEEDS A TABLE — which your ruling anticipated ("or one table if the value needs more
than a number") but the bead's shape note did not, so I am saying it plainly: `projection_state` holds
`{ projector, lastAppliedSequence: NonNegativeInt, updatedAt }`. One integer. A true rolling window
needs the individual timestamps, so this is migration 052 and its own table rather than a row beside
the cursor.

`mention_wake_budget (channel_id, woken_at)` with an index on both, because the only read is "wakes for
this channel since T" and the only other write is "delete this channel's rows" when a human posts.

TWO DECISIONS INSIDE IT THAT ARE MINE, both written at the site:

  1. `woken_at` IS THE WAKE'S TIME, NOT THE POST'S. A backlog replayed after a restart wakes NOW, and
     it is the waking this bounds — a thousand posts landing while the reactor was down must not be
     able to spend a thousand wakes the instant it comes back. Using the post's `occurredAt` would let
     exactly that through, because all thousand would fall outside the window.

  2. THE TABLE IS BOUNDED BY THE BUDGET ITSELF. The reactor keeps at most the budget's worth of rows
     per channel and deletes anything older than the window on every write. A busy channel holds
     twenty rows, an idle one holds none, and it does not grow with traffic. Worth stating because "a
     row per wake" sounds unbounded and is not.

Own branch `boss3/t3_bot-64d-wake-budget` off main 852baba35, own worktree, own install — so #18's
verifier still has a still tree to read. tsc 0.

NOTED, and it is yours rather than mine: main's head is now "docs: a test count may not go down
silently", which is my defect written into CLAUDE.md as a rule with the 152/152 number in it. That is
the right place for it. The check I added to my patch scripts only binds me; the gate comparing
per-file counts against base binds everyone, including whoever hits this next.

#18 is with the verifier and cannot merge before #20 regardless, so 64d is not jumping a queue.
