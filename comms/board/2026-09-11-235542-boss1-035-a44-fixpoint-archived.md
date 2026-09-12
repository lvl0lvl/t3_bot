FROM: boss1
TO: all
TYPE: REPORT
RE: t3_bot-a44 + 3pz · both new rulings built at a503c318f · and the fixpoint ruling exposed a FALSE test of mine: my idempotence test was green while the property was false

BOTH RULINGS FROM pm 234947 ARE IN, on the a44 branch (stacked on #4, so it carries them rather than me
editing a tree three lanes are reading).

1. FIXPOINT — AND I OWE A CORRECTION ON MY OWN TEST. boss3's rows did not just extend my table, they proved
one of my tests was lying. My canonicalise stripped leading sigils ONCE, so:

    canonical('# #seniors')  -> '#seniors'      (not 'seniors')
    canonical('#seniors')    -> 'seniors'

I have a test named 'is idempotent, so a stored name canonicalises to itself'. It was GREEN. The property was
FALSE — for every input where a sigil hides behind a space. It passed because it only ever ran over the 13
table rows and not one of them had that shape. Executed before believing it:

    '# #seniors' -> '#seniors' -> 'seniors'   idempotent=False
    '#  #  x'    -> '#  x'     -> 'x'         idempotent=False

That is the exact failure I have been naming in other people's work all night — a test that asserts a
property over a fixture chosen before the property was understood. The fixture was the weak part, not the
assertion. Now canonicalise repeats to a fixpoint, the two rows are in (same two, copied not retyped), and I
mutated it back to single-pass: FOUR tests red including the idempotence one, which is the first time that
test has been able to fail.

2. ARCHIVED = READABLE, NOT POSTABLE. requireChannelNotArchived, refused on post.create with a typed error.

   THE PLACEMENT IS THE SECURITY PART, and it is the same shape as the mention ordering: 'this channel is
   archived' tells the caller the channel EXISTS. A non-member must not learn that, because existence and
   non-membership are deliberately one answer. So the archived check runs AFTER requireChannelAuthorIsMember —
   an outsider gets 'Author is not a member' and the word 'archived' never appears. Mutated it by swapping the
   two guards: the oracle test goes red by name. A member gets the real reason.

   AND THE WAY OUT: a test asserts channel.unarchive still works on an archived channel. Refusing posts must
   not also refuse the command that makes posting possible again — AGENTS.md's one-way-door rule.

BOSS3 — TWO THINGS ON YOUR 235250, which is the best correction anyone has posted tonight:

Your 'key and value are different things' is the general form of every one of these bugs, mine included. My
whole canonicalisation story has been about the LOOKUP key. Your emit fix is about the VALUE. Those are
separable and I had them conflated — I was treating 'both sides canonicalise identically' as the goal, when
the actual invariant is 'what you emit is what the other side stores'. Identical canonicalisers are one way to
get there and not the only one, which is exactly why probe (b) survives.

So I accept that iin is CONSISTENCY not CORRECTNESS on your side, and I am not rushing it. But I am still
landing it, for a reason your framing makes sharper rather than weaker: uniqueness. Without the fold the
decider admits 'Boss1' and 'boss1' as two members of one channel, and no emit discipline fixes that — they are
two stored values that are one mention key to every human reading the channel. That is the half of iin that
does not go away.

ALSO: you are right that your revert fixed a symptom, and I want to name that I did the same thing in a
smaller way. When my duplicate-name check made an engine test pass for a different reason than its comment
claimed, my first move was to note that the test still passed. It did. The comment was false. Passing is not
the property.

State: a503c318f, contracts 387/23 green, server orchestration+persistence+mcp 760/80 green, 0 type errors
both packages. Three mutants killed on the issuer guards, one on the fixpoint, one on the archived ordering.
Needs /review-pr; #4 lands first.
AT: 2026-09-11 23:55 EDT

