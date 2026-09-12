FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-zuy · #20 at 493baad30 · all 7 lanes in, 30 findings, 5 fixes LANDED and pushed, gate re-run clean by name · the coverage lane told me my six new SQL tests probably did NOT cover two of its mutants and named why — my ordering fixture gave both channels a post so COALESCE and MAX are the same function against it; I ran it, it SURVIVED all 16, fixed at 493baad30 · that is 46h landing on me one test after I wrote a comment about choosing the fixture from the property · two lanes disagreed about executable behaviour and I settled it by reading: reportFailure:true warns the CONSOLE, not the operator · I rejected a security lane fix that would have reintroduced the silent drop · SEC-20-01 still needs your ruling, both fixes are wrong not hard · the history lane found a collision in my OWN #19 that I had missed · NOT asking for a merge: triage, the docstring falsehoods and 4 design p0s remain
AT: 2026-09-12 09:50 EDT

t3_bot-zuy · PR #20 · 493baad30 · all 7 lanes in, 30 findings, FIVE FIXES LANDED AND PUSHED, gate
re-run clean · not asking for a merge yet: triage and the remaining fixes are next.

Your 09:43 ruling taken as read — nothing for me on the ref unification, and thank you for saying the
corrected estimate is what made it assignable. That is the right lesson: the correction was worth more
than the original claim.

LANDED AND PUSHED (each proven by a named mutant, gate re-run after):
  5925692d9  the SQL membership filter — 7 real-db tests, 9 mutants now die
  6dbfcaf03  the mention boundary asymmetry
  cdb5516dc  a refused post now says why, in your decider's own words
  0ded5d56b  the removal-event docstrings stop asserting an invariant that half does not hold
  493baad30  a fixture that can actually SEE the COALESCE fallback

THE ONE THAT SHOULD INTEREST YOU MOST IS THE LAST. The coverage lane told me my six new SQL tests
probably did NOT cover two of its mutants, and named why: my ordering fixture gave BOTH channels a
post, so COALESCE(MAX(p.created_at), c.created_at) and MAX(p.created_at) are THE SAME FUNCTION against
my data. I ran it rather than argue. It survived all 16 tests. It needed a channel with ZERO posts
whose creation time is newer than another channel's latest post.

That is 46h's lesson, landing on me ONE TEST after I wrote a comment about choosing the fixture from
the property rather than from what looks plausible. I have now made this exact error and corrected it
twice in one PR. Both were caught by someone else.

TWO LANES DISAGREED ABOUT EXECUTABLE BEHAVIOUR and I settled it by reading rather than picking:
the design lane suppressed the refused-post finding because "useAtomCommand defaults reportFailure:
true, so refusals do surface". But reportFailure: true calls reporter.warn(...) with reporter =
console, and grep for toastManager across packages/client-runtime returns nothing. It surfaced to the
CONSOLE, not the operator. A true fact about the wrong subject — the same class as reading $? after a
pipe, which I did earlier today, and as a mutant of mine that "died" having executed no tests. I have
told that lane, with the evidence, because its other findings deserve reading in that light.

I ALSO REJECTED A SUGGESTED FIX, on the record rather than quietly. The security lane proposed dropping
handles carrying invisible characters before the wire. That would make the post SUCCEED while waking
nobody — precisely the silent loss the boundary fix just closed. Your decider already fails closed and
names the character as U+200B without echoing the raw handle. So the fix was to SHOW the refusal, not
to swallow the handle. Two findings that each looked right pointed opposite ways, and the interaction
was the answer.

SEC-20-01 IS STILL YOURS, and it is the only thing in #20 I have documented rather than repaired. My
recommendation stands — document and defer, bead filed — and the reason is that both fixes are wrong,
not that either is hard: a delivered-id set breaks the RESUME path (an operator removed while
disconnected is never told to drop the channel; reverse state lost, worse than the leak), and the
event cannot decide it because ChannelMemberRemovedPayload carries handle, not the {memberKind,
memberId} the connection is keyed on. It needs the member ref ON the removal event — contracts +
decider, and it belongs with the accounts work, before that constant becomes a real session.

A FIND AGAINST MY OWN OTHER PR, which I had missed: the history lane reports that my open #19 adds
HUMAN_OPERATOR_ISSUER for this same value and rewrites the same two ws.ts lines. Because #19 and #20
touch DIFFERENT regions of http.ts, they merge cleanly into a state where the HTTP dispatch issuer and
the HTTP shell-snapshot member come from two different constants. I flagged #18's collision in the #20
body and missed my own. Handling it on #19 rather than here.

GATE ON 493baad30: vp check 0, vpr typecheck 0. apps/server 4659 pass / 12 fail, packages 1794 pass /
0 fail, apps/web 4516 pass / 0 fail with 3 files failing to load. The 12 and the 3 are diff-identical
BY NAME to the base worktree. Counts went UP and every delta is accounted for — server 4674->4681
(+7 SQL tests), packages 1791->1794 (+3 mention tests). The history lane also diffed the SET OF TEST
NAMES base vs head for both modified files: 0 names removed. Your 852baba35 rule is satisfied by name,
not by count alone.

Also verified independently rather than on a lane's word: the design lane self-reported writing a
.vite-temp into the reviewed tree's shared node_modules and said it had removed it. It had removed the
CONTENTS; an empty directory remained, because it verified with git status --porcelain, which cannot
see gitignored paths. Benign — nothing was added or repointed, and readlink -f on the @t3tools links
still resolves inside the tree. Removed. Worth noting only because it is the third instance today of
an instrument reporting a true fact about the wrong subject.

STILL TO DO on #20: Phase 3 blind triage over all 30 findings (I will not self-triage), the documented
docstring falsehoods — four comments quote a UI string no component renders, two attribute a docstring
to getChannelById which has none, one claims three callers for a constant with two — the three-state
"this server has no channels" for a snapshot that has merely not arrived, createChannelPost having no
test at all, and the N+1 members query. The design lane returned REVISE with four p0 blockers and I
have asked for the contrast numbers; I will not act on a design verdict without the resolved sRGB
values behind it.

NOT ASKING FOR A MERGE. #20 is better than it was four hours ago and it is not done.
