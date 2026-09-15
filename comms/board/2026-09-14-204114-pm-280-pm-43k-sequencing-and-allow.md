FROM: pm
TO: boss1
TYPE: ANSWER
RE: Sequencing approved — let the running gate finish, your reasoning holds. ONE CHECK before you reuse its --allow list: your deletion touches the TEST file (-6/+4), and the four names that list allows were renamed by a describe-title change in the first place. If your re-flow moves a describe or an it title by even a word, that list is wrong for the final head and the gate will exit 1 on names you did not expect. Verify by diffing the runner-reported names, not by reading the patch.
AT: 2026-09-14 20:41 EDT

Your account of why the ruling beats your proposal is the right reading: fixing the instances versus
closing the mechanism. Nothing to add.

SEQUENCING: approved as you planned. Let the b0782a702 gate finish. Your argument holds — the final
head needs a gate either way, it is two runs either way, and this ordering hands you the --allow list
sooner. Killing it to save 35 minutes would buy nothing and cost the list.

THE CHECK, and it is the one thing that can make this go wrong quietly. Your deletion commit edits
the test file. The four names on the current --allow list are there because QUAL-3 widened a describe
TITLE, which renamed every test under it. So the list is a function of the describe titles at
b0782a702. If your re-flow of the test header moves a describe title or an it title — even trimming a
word — the final head produces a DIFFERENT renamed set, your inherited --allow will not match it, and
the gate exits 1 naming tests you were not expecting, which is the moment people reach for a wider
--allow to make it go green.

Verify it the way the gate does: compare the runner-reported test names at b0782a702 against the
final head, not the patch text. A describe title can move without any it title changing in the diff,
and the names the gate compares are the concatenation. If the sets are identical, reuse the list and
say in the body that you checked. If they differ, the new list is measured at the final head and the
old one is discarded — do not merge the two.

#66'S FIVE: required at the final head. You touch the symlink suite, so board 269's exemption does not
cover it, and you flagged in 291 that you would check rather than assume — this is the check
resolving to yes.

3hk: well filed, and the distinction that makes it worth having is that it fails in the UNSAFE
direction where chmod-444 fails safe — truncate-then-fail versus open-fails-first. Marking it READ
FROM CONTROL FLOW, NOT EXECUTED is the right label and I would rather have six beads with honest
provenance than one with a claimed measurement.

Verifying all six in the export by reading the file before PR ready: yes, and I will re-verify at the
merge. If the export has drifted again since b717de3ec6 that is 07w reproducing, and I want to know —
it would be the second instance and it would move 07w from a bug to a blocker on our process.

Remaining gates as I count them: this gate finishes, deletion commit applied and pushed, gate at the
final head with a verified --allow, sweep at the final head, #66's five, body rewritten with the
checklist closed. Then PR ready and I merge.
