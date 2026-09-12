FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-ami · #29 head 6dbc747f5, CI green by SHA · TWO lanes independently showed my central reachability claim was FALSE and my own tree already recorded the right answer twice · the fixture covered the ordering commands CANNOT produce; second test added for the reachable one · 3 new beads: 1ez, s4l, 2ij · t3_bot-p4u is PR #30
AT: 2026-09-12 16:49 EDT

The lanes on #29 earned their keep and then some. Two of them, from different directions, showed
that the PR's central claim about HOW the collision is reached was false — and that my own tree
already recorded the correct answer in two places.

WHAT I CLAIMED. `requireChannelMemberShape` makes the colliding roster impossible to ADD: a
thread member needs its thread to exist, a human member needs no thread of that id to exist, so
one of two members sharing an id is always refused. Therefore the only route is replay, and this
lookup is a last-ditch defence on legacy rows.

WHY IT IS FALSE. True at a single instant and irrelevant, because the answer changes when the
thread is created BETWEEN the two commands:

  channel.create with a HUMAN member whose memberId is "thread-agent"  -> ACCEPTED
      (the human branch refuses only when such a thread EXISTS NOW, and it does not yet)
  thread.create with threadId "thread-agent"                           -> ACCEPTED
      (client-chosen id; ThreadId carries no format constraint)
  channel.member.add with a THREAD member naming "thread-agent"        -> ACCEPTED
  channel.post.create by that thread                                   -> stored under the
      human member's handle, under the mutant

Four ordinary commands, all as the operator, no replay. bug29 built it against the real engine
and executed it.

AND THE RECORD ALREADY SAID SO, TWICE, IN MY OWN TREE. `t3_bot-46h`'s criterion 4 is recorded
"answered: REACHABLE through the aggregate, by ORDERING (boss3, PR #24)" with that exact route,
and `decider.channels.test.ts:298-302` — added by #24, sitting in this branch — says "the roster
is reachable by ordering". I read ami's bead and wrote the opposite of its own dependency's
answered criterion.

That is the third time today a lane has caught me contradicting something the repository had
already recorded: #20's defect account on #25, the absolute-test-count rule four hours after I
wrote it, and now this. The common shape is that I re-derived an answer instead of looking for
whether one existed. Worth a rule if you want one: before asserting a reachability claim in a
comment, grep the beads and the sibling tests for the same question.

THE PART THAT MATTERS MORE THAN THE COMMENT, and hist29 found it: via commands the human is
NECESSARILY first, because adding the thread member first makes the human add refused. So the
command-producible roster is [human/X, thread/X] — and my fixture was thread-first, the ordering
only replay produces. I tested the unreachable direction and left the reachable one uncovered.

Under the mutant that direction is the mirror impersonation and the worse one: an author ref of
thread/X finds the human row first, so an AGENT's post is stored under a human's handle. In
#seniors, that is a post appearing to come from Walt.

There are two tests now, one per ordering, each asserting its own first row, and the id-only
mutant is killed by both. Also fixed: qa29 measured that reversing my fixture's two rows AND
applying the mutant left all 685 tests green — the fixture's order was the whole measurement and
lived in a comment. It is asserted now, and I re-ran qa29's probe against the fix to confirm the
reversal reds.

THREE NEW BEADS, all from the lanes, all pre-existing, all executed on unmutated main:

  t3_bot-s4l (P2) — `channel.member.remove` on a member holding two handles reports the thread's
      ref as removed and evicts NOBODY. It keeps post rights, read visibility and wake
      eligibility, because membership is keyed by HANDLE in the remove path, the projector and
      the SQL primary key, while every authorization decision is keyed by (memberKind, memberId).
      AGENTS.md's reverse-states rule: the way out exists, reports success, does nothing. This is
      the one I would look at first.
  t3_bot-1ez (P2) — one member id under TWO HANDLES is accepted by a single command, and the
      winning row is not stable across a restart: in memory the projector appends, after a boot
      the projection query is ORDER BY handle ASC. So first-match gives different answers before
      and after a reboot, and whoever writes the rows picks the winner by choosing a handle that
      sorts first. Closing this closes s4l too, and is the smaller fix.
  t3_bot-2ij (P3) — the sweep is in no CI workflow and its config has no mirror row, so the
      "killed by 7 existing tests" figure in a PR body is not reproducible by the checked-in
      tool. Your Phase 1b ruling covers the "who runs it" half; this is the "what it measures"
      half.

#29 state: head 6dbc747f5, fork CI GREEN (4 checks, 0 not-success, keyed by SHA), count-gate exit
0, sweep exit 2 with the survivor being 7rj as reported. Body corrected — the false section is
replaced rather than softened, and it says which claim was wrong.

t3_bot-p4u IS OPEN AS #30. The seeder's `thread.create` carries a deterministic id and the
receipt short-circuit never compares the payload, so #16's corrected `instanceId` reaches a fresh
database and is skipped on every environment that booted before it — which is what the
walkthrough saw. The fix is the hist14 shape: a new command with its own deterministic id, firing
only on the id that shipped, spreading the existing selection so an operator's model choice
survives. Four mutants, one per acceptance criterion, all killed; idempotence asserted on
RECEIPTS rather than rows, because a repair that re-decides every boot writes the same rows.
Count gate exit 0 from its own worktree with its own install; sweep and CI running.

Lanes for #30 next unless you want them scoped differently — it touches apps/server, so the sweep
is already part of it.
