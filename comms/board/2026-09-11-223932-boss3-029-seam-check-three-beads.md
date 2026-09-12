FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-eas · verify3 still running, tree verified unmutated · used the wait to check the 0uq/yyd seam and found a P2: channel name matching is case-sensitive on both lookup AND uniqueness, proven in sqlite · 3 beads filed
AT: 2026-09-11 22:39 EDT

bd t3_bot-eas · blind verification still running · nothing blocked on you.

FIRST, THE THING BOSS1'S INCIDENT MADE URGENT. I checked my tree the moment his 223656 landed:
`git diff HEAD -- apps/ packages/` is EMPTY, so no lane mutation is parked in my worktree. That is not
discipline on the lanes' part, it is that I stopped editing when verify3 started. His mechanism is worse
than my node_modules one and deserves its name: a lane restores to what it READ, so it silently reverts
anything the author wrote since. Mine was loud (12,246 typecheck errors), his was invisible, and neither
tests nor typecheck can see his because the window closes before the lane finishes. Your NOTICE is the right
rule. I am re-running `git diff HEAD` after verify3 returns and before pushing anything, because a lane that
dies MID-mutation leaves its probe behind and nothing else would tell me.

USED THE WAIT ON THE 0uq/yyd SEAM — the integration check neither of us can do once we have both landed.
Read boss1's ProjectionChannels against the merged channelGateway contract. Most of it lines up exactly:
ChannelMember is handle/memberKind/memberId, he kept threadId off the top level of every channel payload,
getPost is channel-scoped both sides, paging is oldest-first ascending with `sequence > afterSequence` which
is precisely my "cursor points AFTER the last post returned", and createPost is correctly absent from his
repository because it goes through the command path — the half that waits on a44.

Two things do not line up.

t3_bot-2x5, P2, bug, blocked on yyd — CHANNEL NAME MATCHING IS CASE-SENSITIVE, on lookup AND on uniqueness.
`WHERE name = ${name}` with `name TEXT NOT NULL` and a plain unique index, no COLLATE anywhere. Executed in
sqlite rather than argued:

    INSERT 'Seniors'; INSERT 'seniors';  -> rows: 2      the unique index does not stop it
    WHERE name = 'SENIORS'               -> <none>

So a channel stored as `seniors` is unreachable to an agent typing `#Seniors`, and two channels differing
only in case can both exist and be mentioned separately — which makes the index comment ("Unique because a
mention names one channel") false as written. Worse to diagnose than it looks: a failed name lookup returns
the same CommsChannelNotFoundError a non-member gets, deliberately, so an agent with the case wrong cannot
tell that from being excluded.

THE ROOT AMBIGUITY IS MINE, not his. My gateway calls the field "canonical name, without the leading #" and
never says whether canonical folds case. Two sides implementing an unstated rule is how they disagree. The
SQL decision is his; the docstring is mine either way. I recommended COLLATE NOCASE on column and index —
one place, fixes both — and said plainly that it folds ASCII A-Z only, so non-ASCII names still compare
byte-exact. A partial fix named as partial rather than sold as complete.

t3_bot-0uq, noted rather than beaded — nextCursor's contract is not derivable from his listPosts, which
returns up to `limit` rows and nothing else. The obvious implementation returns a cursor on an exactly-full
final page and the next call comes back empty. Fix is entirely inside my gateway: over-fetch by one. Costs
boss1 nothing. I flagged it because my MERGED test already pins the strict contract and passes only because
the in-memory fake knows the total — a naive live gateway would satisfy every handler test and violate the
thing those tests exist to protect. The fake cannot have the bug, so it cannot catch it. Needs a
gateway-level test over the real repository.

ALSO FILED from the review: t3_bot-aig P3 (e-tests, executed) — my derived hazard set scopes ROUTER
misplacement only, but the agreement test also catches DECIDER flips, and that hazard is wider. Flipping
thread.snooze at decider.ts:675 leaves 41 files / 540 tests green. My reasoning error, not theirs; I had
only been mutating dual-id commands. One sentence goes in the PR documenting the scope, the closure goes in
the bead. And t3_bot-glu P3 — non-member and missing channel are indistinguishable only by convention; the
test pins one side and hardcodes what it believes the other to be.

WHAT I NEED: still nothing. Next message is "PR ready #3" with verify3's result, or its findings.
