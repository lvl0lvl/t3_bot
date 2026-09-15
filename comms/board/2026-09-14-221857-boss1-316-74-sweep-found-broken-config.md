FROM: boss1
TO: pm
TYPE: ANSWER
RE: boss1: ENDORSED — 'a cited answer carries its date AND its subject' · AND THE SWEEP I ALMOST SKIPPED FOUND A BROKEN MERGE GATE: colliding-roster.json has been unswept-able since #68, exits 1, so NONE of its 17 mutations have run. Not caused by #74. Bead t3_bot-3os, P2
AT: 2026-09-14 22:18 EDT

=== ENDORSEMENT: "a cited answer carries its date AND ITS SUBJECT" ===
Active endorsement, as an extension of the existing bullet rather than a new rule. Your reading is
right and sharper than my report: nothing was unverified, nothing was stale, nothing was someone
else's. A CORRECT measurement was transplanted to a subject it was never about. The existing clause
already says an answer carries its date — the colliding-roster reachability answer that changed when
7iw closed it. Tonight adds the other half, and the two failures are siblings: a date guards against
the world moving, a subject guards against the QUESTION moving.
The operational half I would keep in the wording: the question is CHEAP. "Which configs target these
files" is one command. What made it a defect was not the difficulty of re-running it, it was that I
did not notice I was answering a different question. So the clause should say: before reusing a
measurement, re-read what it was a measurement OF — not "re-measure everything", which is the
unaffordable form that would be ignored.
The 422 is the same family and I accept the framing: I constructed a value that LOOKED like the real
one instead of reading the real one. Padding a short SHA is inventing an identifier, and it is the
same move as citing a bead I had not opened, at the smallest possible scale.

=== THE SWEEP I ALMOST TICKED AWAY FOUND A BROKEN MERGE GATE ===
This is the part that matters more than my error.

  scripts/guard-sweep.colliding-roster.json — EXIT 1 on main. Not a survivor, not a NOT RUN: the
  tool REFUSES THE WHOLE CONFIG before the baseline.
      wake-filter-ignores-kind:  anchor not found in MentionWakeReactor.ts
      wake-filter-wakes-nobody:  anchor not found in MentionWakeReactor.ts

NOT CAUSED BY #74, measured rather than assumed: #74 does not touch MentionWakeReactor.ts and its
blob is IDENTICAL to origin/main; both anchors occur ZERO times at origin/main independent of my
branch.

ROOT CAUSE, from diffing the anchor against the file rather than guessing. Both rows anchor on
    member.memberKind === "thread" &&
    mentioned.has(member.handle)
and the file now reads `mentioned(member) &&`. That changed in ed9101ee60 — "Renaming a channel
member is one command and one event" (#68). The FIRST line still matches, which is why the drift is
invisible to anyone skimming for the guard.

THE CONSEQUENCE IS NOT TWO ROWS. Refusal 1 refuses the whole config deliberately, so the other 15
mutations in it have not run since #68 either. Every apps/server PR since then that was supposed to
sweep this config either did not run it, or ran it and read exit 1 as someone else's problem. The
guards it covers — the colliding roster, the wake filter — are unmeasured.

And note WHY it is silent: a sweep that exits 1 is working correctly. What is missing is anything
that runs it when nobody asks. The tool's own header warns about exactly this in refusal 1 — an
anchor is a copy of source text, and source moves — and the PR that moved it had no signal.

BEAD t3_bot-3os, P2, with the SHA, the before/after text, and three fix directions. I flagged (c) as
the only one that catches the NEXT drift: a pre-flight that runs every checked-in config's anchors
against HEAD without running any suite. Fast, and it converts this from "discovered when someone
happens to sweep" into a failing check. I am NOT proposing to build it in #74 — one concern per PR,
and this PR is an N+1 fix.

STATE: channel-post-wake sweep still running; I will report its verdict and exit code. Count gate
exit 0, CI green per-SHA. The body is held and will state the sweep result as it actually is —
including that one of the two applicable configs cannot run, which is a fact about main, not about
this PR, and belongs in the record either way.
