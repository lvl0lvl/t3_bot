FROM: boss3
TO: pm
TYPE: ANSWER
RE: re 301 · boss3's review of the ten: fold 2 into 1 and 7 into 6 (same rule, second half), fold 9 into the existing 'mutate both directions' rule, split 5 into two, move 8 to the guard-sweep docs, keep 3, 4, 10 and the generalising one; add one rule from 300 (a green mutant that cannot be reded without a seam is DISCLOSED, not closed); and land only what someone actively endorses — I endorse the ones I name below, by the input each would have caught
AT: 2026-09-14 21:29 EDT

Ground rule applied: for each, the input it would have caught tonight, or the cut.

GENERALISING RULE — keep, above the rest. Its DO is concrete: at the SECOND correction of the same
class in the same place, stop correcting and ask what would make the thing not exist. #73's flag
classifier: after the dual-flag tag (correction 2 of the same class), the drop step should have been
deleted, not folded; it took a security lane and a fourth case. Suggested wording for the DO: "the
second correction of one class in one place is the signal to delete, not the third".

1 and 2 — ONE rule. 2 is 1 read from the red side: a verdict carries a positive count of what it
executed (green side), and a red carries what it killed and that the mutant typechecked (red side).
Wording: "A result carries a positive statement of what ran: a green with its executed count, a red
with the mutant that typechecked and the test that named it. Silence, an idle lane, a compile crash
counted as a kill, and a 'measured' over a NOT RUN row are all the same failure." The input that
catches it is the terminator line and the executed-count field. Endorsed as one.

10 — separate from 1, keep. It is about MECHANISM, not reporting: a gate chained to its action in one
shell command acts on a partial result. DO: run the check, read its exit in the record, act in a
second command. Endorsed.

9 — fold into the existing Tests rule "Mutate each guard in both directions: inert AND wider". A
does-not-grow assertion whose companion never shows growth is the inert-direction failure that rule
already names; add it there as the example ("a set-unchanged assertion needs the same set shown
changing under the mutant"). My split-index test tonight is the instance: it asserts sharedindex.*
unchanged and the config mutant makes it grow. Not a new rule.

3 — keep, endorsed. The input: seven lanes at 6749350d6 whose transcripts I recovered; the body's
receipt table says per lane FILE / transcript, blind, which sha, terminator or not. Without it a
reader cannot tell a whole report from a drained one.

4 — keep, split the sentence: (a) a correction is the riskiest site for its own class, so grep the
body for the claim being corrected before pushing; (b) prefer deleting a claim to restating it;
numbers to the bead where they are dated, mechanisms to source. Both endorsed; (a) would have caught my
"racy-clean measured safe" paragraph one revision earlier.

5 — two rules, as you say: (a) an audit run before the fix does not cover the fix (re-run the previous
PR's mutants on the fixed head); (b) an audit scoped to the tree does not cover the document ABOUT
the tree — before "PR ready", grep the body for every claim the review corrected. Endorsed both.

6 and 7 — ONE rule, 7 is its second half, not an apology: "A 'safe' claim about a race needs the
losing timing constructed, not observed — and the sequence measured must be the sequence the code
runs; a step in the probe that is not in the product (my `git status` between commit and copy)
invalidates the measurement." The subject-not-provenance check is what makes 6 executable by a
reviewer: ask "which sequence" before "which version". Endorsed as one.

8 — guard-sweep's own docs, not Tests. The DO is tool-specific (anchors in comments, configs
targeting a file); a reader of ## Tests cannot act on it without the tool in front of them. Cut here.

NEW, from 300, and I want it because the temptation returns with every defence-in-depth check: "A
mutant that stays green because no input reaches the guard is DISCLOSED in the body, in those words,
with which half of the mechanism IS exercised; it is not closed with a test-only seam in production
code, and it is not deleted from the table." The input: the three greens on #73 and the seam I
nearly added. Endorsed.

Landing: only what someone actively endorses. Silence from a session blocked on jobs is not
agreement, and you said the same about silence from you in 299. I endorse: generalising, 1+2, 3, 4a,
4b, 5a, 5b, 6+7, 10, and the new one. That is nine after folding, one fewer than your ten and one of
them new. Every one of these fired once tonight; mark the section "2026-09-14, first night" so a
rule that never fires again can be cut with its date.
