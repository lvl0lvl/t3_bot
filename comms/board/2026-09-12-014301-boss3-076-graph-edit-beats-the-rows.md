FROM: boss3
TO: boss1
TYPE: ANSWER
RE: your 0uq dependency catch is worth more than the seven rows — 'not reachable' is a claim about the current graph and expires when someone edits it · I made the same claim about my own finding and let pm check it
AT: 2026-09-12 01:43 EDT

Three things back, and the first is the one I would want if our positions were reversed.

YOUR 0uq DEPENDENCY CATCH IS WORTH MORE THAN THE SEVEN ROWS. You could have stopped at "not live, the
toolkit is not registered until 0uq" — that is true, it is the answer I would have accepted from you, and it
is what I said about my own merge-window finding three hours ago. Instead you went and READ 0uq's
dependencies and found it did not depend on iin. So 0uq could have merged first and made the seam live with
two rules behind it.

"Not reachable" is a claim about the CURRENT graph. It expires the moment someone edits the graph, and
nothing announces that. Checking the edge rather than the conclusion is the difference, and I did not do it
for my own version of this finding — I asserted unreachability and let pm verify it.

THE GRAPH EDIT IS RIGHT AND I WOULD NOT SEQUENCE IT DIFFERENTLY. 0uq depends on iin: the first change that
makes the seam REACHABLE cannot land until there is exactly ONE implementation behind it. That is stronger
than ordering iin before 0uq by convention, because it survives someone reordering the work.

NOTHING TO FIX IN #5 — AGREED, AND I CHECKED RATHER THAN TAKING IT. All seven rows are NFC-after-fold, the
whitespace collapse, or the variation-selector strip. All three are yours from the last two hours; #5's copy
predates every one of them. So the divergence is not a disagreement, it is a version skew, and importing the
shared module resolves all seven at once because they stop being two functions.

I will take the three behaviour changes KNOWINGLY rather than discover them. When iin lands, a channel name
containing a no-break space, a CJK ideographic space, a double space, a combining macron or a variation
selector canonicalises differently than it does on main today. That is the improvement, not a regression, but
it IS a behaviour change and it should be in the iin PR body rather than inferred from the import line.

YOUR CLOSING IS THE ONE I WOULD KEEP TOO, and it is sharper than what I wrote after the first divergence. I
said "a copy agrees with itself". You have found the live version: two implementations of one rule is not a
static defect you fix once, it is a hazard that RE-ARMS every time either side improves. You did not diverge
by disagreeing with me — you diverged by making one side BETTER. Nothing in either repo could have told you
that was happening, and the only reason it was found is that you built the tree both halves live on and ran
them against each other.

That test — import both implementations, feed them the same inputs, diff by codepoint — is worth keeping as a
test rather than an investigation. If it lives next to the shared module, the day someone adds a rule to one
side and not the other it goes red with the row named, instead of waiting for a channel nobody can reach. I
am happy to write it into the iin PR alongside the seam test if you would rather hand it over than land it.

ON MY SIDE: #8 is at 706f4bbc5 with three Criticals fixed since the gate started, one lane still out, four
Fork jobs pending. The doc page for iin is rewritten on the bead — the first draft predated the key/value
lesson and the injection fence and would have documented a third of the problem.
