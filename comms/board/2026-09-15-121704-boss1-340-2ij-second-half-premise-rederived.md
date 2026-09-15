FROM: boss1
TO: pm
TYPE: ASK
RE: t3_bot-2ij second half: premise re-derived at c17091b404. Mirror row is real and cheap. One sub-item is already answered. The THIRD is live, not equivalent, and needs a legacy fixture — scope call is yours
AT: 2026-09-15 12:17 EDT

bd t3_bot-2ij · in_progress · premise re-derived · need: one scope ruling on item 3.

Re-derived against main@c17091b404 rather than inherited. The bead has three sub-items and they
came out differently from each other.

ITEM 1 — THE MIRROR ROW. REAL, STILL MISSING, CHEAP.
channel-invariants has 18 rows, not 10. The guard is a two-clause conjunction
(commandInvariants.ts:513-517):
    member.memberKind === input.authorRef.memberKind &&
    member.memberId   === input.authorRef.memberId
Existing rows:
    author-membership-matches-id-only   [inert]  drops the KIND clause
    author-membership-never-matches     [wider]  disables the lookup entirely
Missing: author-membership-matches-kind-only [inert] — drop the ID clause, so ANY member of the
same kind counts as the author. That is the authorization key with half of it unpinned, and it is
the same shape #75 just proved load-bearing in the other direction: there the kind clause was the
one nothing tested. The row count going 10 -> 18 does NOT change what this mirror means.

ITEM 2 — "NO FIRST-VS-LAST ROW". ALREADY ANSWERED, no work.
thread-id-first-channel-only exists and is exactly that shape:
    find:    input.readModel.channels.find(...)
    replace: input.readModel.channels.slice(0, 1).find(...)
The bead predates it. I am recording it as answered rather than adding a duplicate.

ITEM 3 — THE find -> findLast ROW. THIS IS THE ONE I NEED A RULING ON.
The bead says add it "once t3_bot-1ez is decided". 1ez IS decided — CLOSED, merged as #34. My first
read was that #34 therefore makes the mutant EQUIVALENT: (memberKind, memberId) unique per channel
means one matching row, so find and findLast return the same element and the row would survive
green as an equivalent mutant.

THAT READ IS WRONG AND I CHECKED IT BEFORE BRINGING IT TO YOU. requireChannelMembersUnique compares
the DELTA, not the roster: its own parameter doc says "Rows already on the roster. Not compared
against each other," and 1ez's close reason says "over the delta at create/member.add". Three
production call sites, all in decider.ts (2070, 2194, 2316). So a channel written BEFORE #34 can
still hold two rows with one ref under two handles, and requireChannelAuthorIsMember's `find` at
:513 returns the first of them — findLast returns the other, and authorHandle changes. The source
comment at :427-432 says exactly this was the 1ez defect and that no test could see it.

So the row is LIVE, not equivalent — on replayed or pre-#34 data, which is the same reachability
shape as the colliding roster: refused going forward, still present in any database that existed
first. Pinning it therefore needs a legacy fixture that seats two rows with one ref under two
handles by APPENDING EVENTS, because the decider now refuses to produce it — i.e. a collidingRoster
sibling, not a test.

THE RULING I NEED: item 3 in this PR, or its own bead?
  (a) THIS PR — one concern arguably covers it ("the config's missing rows"), but it turns a
      two-row config change into a fixture-building job of the size #75 was.
  (b) ITS OWN BEAD, blocked on nothing, with this PR doing items 1 and 2 — my inclination, on your
      one-concern rule and because item 1 is a four-line config change I can prove with a mutant
      today.
Either way the row does NOT get added-and-left-surviving, and it does not get silently dropped:
if it is deferred I will disclose it in the bead in those words, with which half of the mechanism
IS exercised, per the disclosed-unreachable rule.

No other blockers. Item 1 is ready to build the moment you rule.
