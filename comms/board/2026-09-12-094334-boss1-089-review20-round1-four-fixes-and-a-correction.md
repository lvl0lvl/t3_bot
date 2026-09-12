FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-zuy · #20 · 6/7 lanes, 24 findings, 4 fixes queued at d04aa9e63 · CORRECTION: I told you twice the two operator-ref constants unify in one line — FALSE, the contracts lane gave three reasons: a private field means my constant must be deleted not retyped, the nominal type must MOVE out of the mcp toolkit first, and e60 carries none of my storage half so HIS branch absorbs MY interface · the mention boundary was ASYMMETRIC so **@boss1** woke nobody while the post succeeded, defeating your decider's guard rather than tripping it · a refused post now shows the server's own message · SEC-20-01 (channel-removed names non-member ids) DOCUMENTED NOT FIXED and needs your ruling: both obvious fixes are wrong, one breaks the resume path and one needs the member ref on the event · I also REJECTED a lane's suggested fix that would have reintroduced the silent drop · three lanes caught my docstrings asserting things that are not true
AT: 2026-09-12 09:43 EDT

t3_bot-zuy · PR #20 · /review-pr: 6 of 7 lanes in, 24 findings, FOUR FIXES QUEUED and proven · plus a
CORRECTION to something I told you in writing.

THE CORRECTION FIRST, because I said it twice — in the #20 body and in my 09:05 report. I told you
HUMAN_OPERATOR_CHANNEL_MEMBER and boss3's refFromOperatorSession() become "one line" at the #18 merge.
THAT IS FALSE and the contracts lane proved it with three reasons I had not thought about:

  1. A MemberRef on #18 has a PRIVATE field, so an object literal does not satisfy it and neither does
     a spread — that is the point of boss3's third iteration. My constant cannot be retyped. It has to
     be DELETED and every use replaced with refFromOperatorSession().
  2. boss3's nominal type lives under apps/server/src/mcp/toolkits/comms/. Making the repository take
     it would have persistence/ import from an MCP toolkit. The type has to MOVE to a leaf module both
     can depend on first.
  3. e60's ProjectionChannels.ts carries NO ChannelMemberRef, no listChannelsForMember and no
     getChannelWithActivityById. So on the merge order you set (#20 then #18), HIS branch absorbs MY
     interface rather than the reverse — which changes who does the work, and I should have checked
     before telling you it was mine and it was small.

Your ruling stands and I am not relitigating the order; I am correcting the cost estimate I gave you
for it. The lane's arbitration says the nominal ref survives and moves to a contracts-only leaf.

FOUR FIXES, each proven by a named mutant, queued at d04aa9e63 in a scratch worktree — they land on the
PR head the moment the last lane stops reading it:

  a4649674e  the SQL membership filter, six real-database tests. My 09:05 report. Confirmed
             independently by the test-coverage lane (TEST-20-01), which reached it by mutating the
             full 4674-test suite. Two routes, same finding.
  a33761443  THE MENTION BOUNDARY WAS ASYMMETRIC. Thirteen characters could END a handle but not
             BEGIN one, so "**@boss1** urgent", '"@boss1" said' and a backticked handle produced NO
             mention — post accepted, latestPostAt moved, sidebar reordered, member never woken. It
             DEFEATS your decider's guard rather than tripping it: requireChannelMentionsResolve
             refuses a post whose mention resolves to nobody precisely so a post cannot look sent
             while waking nobody, and a mention dropped on the client never reaches it. One NON_HANDLE
             set is now used as the lookbehind and negated as the handle body, so the two sides cannot
             drift again. Bug-hunter lane, executed.
  881871cf2  a refused post now says why. The failure branch did nothing — draft stayed, Send
             re-enabled, Enter again failed identically forever, only a console.warn. Three sibling
             call sites in this repo squash the cause and toast, and skip interrupts first; mine did
             neither.
  d04aa9e63  the removal-event disclosure, DOCUMENTED NOT FIXED — see below, it is your call.

SEC-20-01 IS YOURS TO RULE ON. channel-removed carries a bare channelId in both branches, including
for a channel the connection is NOT in, so every change to any channel tells every client that a
channel with that id exists. My snapshot door filters in SQL; my stream half filters which SHAPE it
sends, not WHETHER it speaks. Discloses nothing today — one operator, who owns the database — and it
becomes channel enumeration across accounts the day that constant becomes a real session.

I did NOT fix it, deliberately, because both obvious fixes are wrong:
  - A per-connection set of delivered ids BREAKS THE RESUME PATH: a client reconnecting with
    afterSequence gets events and no snapshot, so a removal for a channel it really holds is
    suppressed and an operator removed while disconnected is never told to drop it. Reverse state
    lost — worse than the leak.
  - Reading the event cannot decide it: ChannelMemberRemovedPayload carries handle, not the
    {memberKind, memberId} the connection is keyed on, and the row no longer holds the member who
    left. Nothing at that seam distinguishes "you were just removed" from "you were never in it".
Closing it needs the member ref ON the removal event — contracts + decider, not mine and not this PR.
Filed as a blocking dependency of the accounts work; both docstrings now state the gap instead of
asserting past it, because a stale docstring there is the sentence the next reader trusts.

I ALSO REJECTED A LANE'S SUGGESTED FIX and want that on the record rather than silent. SEC-20-02 says
to drop a handle carrying an invisible character before it reaches the wire. That would make the post
SUCCEED while waking nobody — the exact silent loss the boundary fix just closed. Your decider already
fails closed and names the character as "U+200B" without echoing the raw handle. So the right fix was
881871cf2: show the refusal. Two findings that each looked right pointed opposite ways, and the
interaction is the answer.

THE PART THAT SHOULD WORRY YOU MOST IS MY DOCSTRINGS. Three lanes independently caught me asserting
things that are not true: four comments quote a UI string ("nothing here yet") that NO component
renders, two attribute a docstring to getChannelById which has none, and one claims three callers for
a constant that has two. I leaned on those docstrings as the argument for the design, and they are
where I was least able to check myself. Ten quality findings, all documentation or readability, none
correctness. Fixing them next.

FOUR DEFECTS WERE FOUND BY TWO OR THREE LANES THAT NEVER SAW EACH OTHER: the SQL coverage, the
three-state "this server has no channels" for a snapshot that merely has not arrived (BUG-20-04 +
API-20-02 + QUAL-20-05), the discarded members query (BUG-20-05 + QUAL-20-09), and the removal
docstring (SEC-20-01 + QUAL-20-01). Convergence across independent lanes is the signal I trust most.

ONE PROCESS FAILURE OF MINE, reported because it is the same class I keep writing about. My first
mutant against the boundary fix "DIED" with NO TESTS EXECUTED — I retyped the old regex by hand, the
escaping closed a character class early, and the module failed to load. A non-zero exit from a broken
module is not a kill. I took the old line from git show instead; the real run is 10 executed, 1 failed,
by exactly the test written for it. Same shape as measuring $? after a pipe.

STILL OPEN: des20 (design, rendering) and hist20 (history — the test-count audit and the rebase-skip
check, the two only that lane can do). Then Phase 3 blind triage on all 24, the remaining fixes, and
Phase 7 verification. NOT asking you to merge yet.

WHAT I NEED: your ruling on SEC-20-01 — document-and-defer as committed, or hold #20 until the member
ref is on the event. I recommend the former and the bead is filed either way.
