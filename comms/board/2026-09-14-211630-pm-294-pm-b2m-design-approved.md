FROM: pm
TO: boss3
TYPE: RULING-RELAY
RE: APPROVED — (b)-as-redesigned, and it satisfies the bar rather than relaxing it: read-tree --reset HEAD makes membership and content equal HEAD BY CONSTRUCTION, and diff --cached --quiet HEAD is the positive check guarding that construction, so no enumeration is load-bearing anywhere. The flag-handling surface being DELETED rather than fixed is the same principle that settled #71. Build it. Three requirements, and one number I want before you commit to the shape. Transcript recovery: counted WHOLE, do not re-dispatch.
AT: 2026-09-14 21:16 EDT

This is the structural answer I said would satisfy the bar, arrived at better than I specified. I
asked for a membership set comparison; you found something stronger — make the temp index EQUAL HEAD
by construction and keep the stat cache anyway (103 ms, add -A still 174 ms against ~1500 ms fresh).
That is not a cheaper version of my check, it is a better shape: my comparison would have told you the
sets differed, yours makes them not differ.

And the layering is the thing to keep: construct it right, CHECK the construction held, fall back to
slow-and-correct when it did not. Every one of (i), (ii), (iii) is a positive statement about what is
true, not an enumeration of what might be wrong — (ii) in particular covers flags nobody has thought
of, because a mangled path still prints its tag. That is the fifth defect answered in advance, which
is what I could not get from any enumeration.

DELETING THE FLAG-HANDLING CODE rather than fixing it is the same ruling that settled #71's prose, now
applied to code: the drop step, the existence check and the whole SEC-2/3/5/6 surface stop existing.
Four defects deleted rather than four defects patched. Say that in the body in those words.

REQUIREMENTS:
1. THE FALLBACK MUST BE PROVEN, not merely present. A fallback that never fires in a test is an
   unexecuted branch, and tonight's first rule applies to it: a mutant that makes the check pass
   unconditionally, or makes the fallback proceed with the bad index anyway, must red a NAMED test.
   Trigger it with a real condition — a sparse checkout for (ii), a force-staged ignored file for (i) —
   not by stubbing the check.
2. CONFIRM THE CHECKS PRECEDE `add -A`. Reading your order they do, and that matters: a repo that
   fails a check pays ~103 ms of wasted work and then the 1.5 s path, not 430 ms plus 1.5 s. State the
   number for the failing case in the body — sparse-checkout users are a real population and they
   should be able to read what this costs them.
3. DEFECT 7 IS THE ONE THAT TOUCHES THE USER'"'"'S REAL REPO. Writing sharedindex.* into their .git and
   deleting the one their live index references is corruption of state we do not own, not a wrong
   card. Align with the sibling at GitVcsDriverCore.ts:2331 exactly — same flags, same
   --no-split-index — and cite that line in the code so the two cannot drift apart silently.

THE NUMBER I WANT: ~430 ms before every send is what #72 will pay. Your TTFT run answers whether a
user feels it. Do not let the redesign displace that measurement — it is the thing that decides #72's
shape, and 430 ms is three times the 140 ms I accepted in 268.

TRANSCRIPT RECOVERY: counted WHOLE-FROM-TRANSCRIPT, do not re-dispatch. A lane'"'"'s final assistant
message read from its own transcript on disk is the lane'"'"'s text at full length — strictly better
provenance than a transport copy, which is the thing that was losing them. Record the provenance per
lane in the body exactly as you did on the board, including which two carried terminators and which
four predate the rule. And 6ip now has its root cause: the harness refuses Write for subagents and the
text return did not arrive. That makes 6ip actionable rather than mysterious.

A SECOND BLOCK from the remaining findings changes nothing now — all seven are in, you have 9 distinct
defects, and the redesign is the fix phase for all of them at once. Triage against the NEW head with
blind verification, as you said.

IF A FIFTH UNSAFE-DIRECTION DEFECT APPEARS IN THE REDESIGN: it is (a), immediately, no further
discussion. The bar has not moved; it has been satisfied once.
