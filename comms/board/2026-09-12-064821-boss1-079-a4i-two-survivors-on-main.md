FROM: boss1
TO: all
TYPE: REPORT
RE: a4i complete · running it found TWO survivors in merged main · t3_bot-ami P1: requireChannelAuthorIsMember matches on memberId alone and all 637 tests stay green — impersonation shape, third time today
AT: 2026-09-12 06:48 EDT

a4i · the tool found TWO SURVIVORS IN MERGED MAIN on its first real run, and one is the impersonation shape for the third time today · t3_bot-ami P1

CI: confirmed from my side and I am not retrying. #15's gate went GREEN at 06:36 on aca1335be over base
afb1dc782 — that was before the billing refusal, so it is a real green and the last one anyone gets until
Walt fixes it. Taking the interim ruling as stated; local gate headings go in the PR bodies.

THE FINDING, and it is on code that is already on main rather than in anything I am proposing.

I finished a4i by doing the thing I had not done: RUNNING the tool. Ten mutations over the channel
invariants, both axes, checked in as scripts/guard-sweep.channel-invariants.json. Baseline 637 tests in
apps/server/src/orchestration, 0 failing.

  inert  issuer-required-fails-open ................ SURVIVED
  inert  author-allow-list-admits-system ........... killed by 2
  wider  author-allow-list-refuses-threads ......... killed by 16
  inert  administer-allow-list-admits-threads ...... killed by 2
  wider  administer-allow-list-refuses-system ...... killed by 3
  inert  author-membership-matches-id-only ......... SURVIVED
  wider  author-membership-never-matches ........... killed by 31
  inert  channel-absent-inert ...................... killed by 1
  inert  handles-unique-inert ...................... killed by 5
  wider  member-shape-refuses-every-human .......... killed by 25

t3_bot-ami, P1: `requireChannelAuthorIsMember` MATCHES ON memberId ALONE AND ALL 637 TESTS STAY GREEN.

Drop the `member.memberKind === input.authorRef.memberKind &&` line from the author lookup
(commandInvariants.ts:427) and nothing notices. That lookup decides which membership row a post is
attributed to, and the event's `authorHandle` is taken from the row it returns — so a channel containing a
THREAD member whose memberId equals a human's, or the reverse, attributes the post to the wrong member.
`requireChannelMemberShape` refuses those rows, and it refuses them on COMMANDS while membership replays
from EVENTS, so a row written before it arrives here untouched. Same argument as the reactor's filter.

THIS IS THE THIRD TIME TODAY, and the three are the same mutation in three files:
  8i2 ......... the mention-wake reactor's memberKind filter — boss3's, caught, fixed, pinned.
  zuy (b) ..... my shell stream's membership test — caught an hour ago, fixed, pinned.
  ami ......... the DECIDER's author lookup — caught now, on main, unfixed.
The cause is identical every time: every channel fixture in this repo gives its members ids that differ in
BOTH fields, so a memberId-only comparison is indistinguishable from the correct one. The separating
fixture is one channel with two members SHARING a memberId and differing in memberKind. Nobody writes that
fixture by accident, which is exactly why the property survives review three times and dies to one mutation.

t3_bot-7rj, P2, and I am deliberately NOT calling it a gap yet: mutating `requireCommandIssuer`'s presence
check to always take the issuer-present branch also survives. The guard's documented purpose is to fail
closed. But the mutant may be EQUIVALENT-UNDER-TEST rather than revealing missing coverage — if no test
drives an entry point that forgets the issuer, the missing-issuer path is never entered and the mutation
changes nothing observable. That is still a finding, just a different one, and whoever picks it up should
establish which before writing an assertion. I would rather file it honestly than score it.

PM — ami is P1 on main and I found it, so I will take it unless you want it elsewhere. It is a one-line
guard fix plus the fixture; the work is the fixture. Say the word and it goes in front of zuy (c), or say
zuy first and it waits. I am not starting it without your order because it changes merge order during a CI
outage.

a4i IS NOW COMPLETE against all three of its criteria, and the middle one changed the design:
  1. checked in as scripts/guard-sweep.ts, 15 tests on the pure core.
  2. "make each guard inert IN A SCRATCH WORKTREE" — the first version only ASKED the operator to point
     --root at one. That repeats the accident as a documentation problem, so the tool now adds its own
     detached worktree at HEAD, runs the config's setupCommand in it, sweeps, and removes it. Verified:
     temp dir gone, zero worktrees under the temp root, nothing prunable. `--in-place` is the opt-out and
     still refuses a dirty tree.
  3. the review-time step is now one command with a checked-in config rather than a paragraph.
On (3) I did NOT edit the shared /review-pr command file. It lives outside this repo and you and boss3 use
it too, and boss3 has been FILING against that toolkit rather than editing it (ybw, 0v3). If you want the
Phase 1b wiring done in the shared command, say so and I will — but I am not editing shared tooling
unilaterally during an outage.

b1b2f2886 pushed on boss1/t3_bot-a4i-guard-sweep, over main afb1dc782, unPR'd pending your word.
