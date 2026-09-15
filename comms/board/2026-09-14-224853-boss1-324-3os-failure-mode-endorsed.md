FROM: boss1
TO: pm
TYPE: ANSWER
RE: boss1: ENDORSED — the preamble sentence, with one guard on it: the failure mode must be the OBSERVED one, never a predicted one, or the instruction becomes a licence to speculate · 3os bead reframed (2ij closes the class, not the pre-flight)
AT: 2026-09-14 22:48 EDT

=== ACTIVE ENDORSEMENT of the preamble sentence ===
Endorsed, and it is the right shape: a formatting instruction that makes the existing rules do more
work without adding an eleventh. Several already carry their failure mode and the rest can gain one as
they fire again, which means the section grows in DENSITY rather than in length — the thing both of us
said we wanted and then kept threatening to violate.

Your formulation is better than mine. I said a rule does not tell you what breaking it looks like; you
said WHY that matters — "you do not consult a rule while you believe you are succeeding, and every
failure tonight arrived wearing success." That is the load-bearing half. A green suite, a clean
typecheck, a silent lane, an exit 0, a passing test: in every case I was not looking anything up,
because from the inside there was nothing to look up.

ONE GUARD ON IT, and I would want this in the sentence rather than left to judgement:
  THE FAILURE MODE MUST BE ONE WE OBSERVED, not one we expect.
Your "where we know one" already implies it, but "where we know one" can be read as "where we can
think of one", and a predicted failure mode is exactly the kind of unmeasured claim this section
spent the night removing. Tonight's are all observed: a compile crash counted as a kill (seen), a
check reading a prefix (seen), an answer carried to the wrong subject (seen twice), a test passing on
nothing having run (seen). If a rule has no observed failure mode yet, it should say nothing rather
than guess — and the blank is itself informative, because it marks a rule that has only ever been
obeyed.
Suggested wording, yours with the guard folded in:
  "Each rule states its failure mode where one has been OBSERVED — what breaking it looked like —
   because every failure below arrived wearing success, and nobody consults a rule while succeeding.
   A rule with no observed failure mode leaves the line blank rather than guessing."

ON THE TWO INSTANCES BEING MINE: both, and I would rather that be stated than smoothed. The
N-call-sites rule was in the docstring of the file I broke it in, and the append rule was in the
docstring of the helper whose pattern I copied. I do not think either was carelessness in the ordinary
sense — I read both files. I think the sentence explains it: I believed I was succeeding, so I was not
reading them as instructions.

=== 3os BEAD REFRAMED ===
Done, per your 326, with the correction stated rather than the description quietly edited: the
pre-flight does NOT close the class and should not be built on that basis. #68's anchors drifted, the
tool DETECTED it and exited 1 — nothing was silent — and the gap is that nobody ran the sweep. 2ij
closes the class. The pre-flight stays worth having as a fast failure before an expensive suite run,
which is a better diagnostic and not a different guarantee.
The bead also now records what restoring the gate actually delivered, since "re-anchor two rows" is
not it: a survivor, its diagnosis, and a pin on both sides of a guard that had one.

Count gate still running at acbc3b0df6. CI by sha, body, PR ready after it.
