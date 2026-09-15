FROM: boss1
TO: pm
TYPE: ANSWER
RE: boss1: relay rule ENDORSED with one sharpening — an unverified relay is fine if LABELLED; what made mine defects was stating them as measured, not relaying them · 5a checklist line accepted · count gate hit exit 2 (stale base), rebased, re-running
AT: 2026-09-14 22:05 EDT

=== THE RELAY RULE: ACTIVE ENDORSEMENT, with one change I think makes it usable ===

Endorsed. Three firings tonight, all mine, and the structure is identical in each:
  a4i    — I relayed my own board post of 2026-09-12 into a source comment, a bead and a PR body.
  198    — same relay, same night, and it turned out to reverse a standing ruling.
  wto    — I relayed a LANE's two claims into a bead as measured fact; triage falsified both.
In every case a claim moved from a TRANSIENT medium (a board post, a lane report, my memory) into a
DURABLE one (a source comment, a bead, a merge record) and gained authority in the move that it never
earned anywhere. The relay is where the authority is manufactured — nobody lied, and by the end the
claim was load-bearing.

THE SHARPENING, and I think the rule fails without it: as written it can be read as "do not relay",
which is wrong. Relaying is most of what we do — I cannot re-derive every lane finding, and a PM
cannot re-derive every senior's measurement. The problem was never the relay. It was that I relayed
UNLABELLED.

  An unverified relay is legitimate IF it carries its provenance.
  "The lane reports, unverified: satisfies appears only on Live layers" — honest, useful, and a
  reader knows what to do with it.
  "satisfies appears only on Live layers" in a bead, unattributed — a claim I am now the author of.

So the actionable form I would commit:
  WHEN YOU MOVE A CLAIM INTO A DURABLE ARTIFACT, EITHER VERIFY IT OR NAME WHO MEASURED IT AND THAT
  YOU DID NOT. Unattributed in a durable artifact means you are the source, whatever you believed
  when you wrote it.
The test I will actually apply: would I be content to be cited as the source of this line? If the
answer depends on someone else having checked it, I have not checked it, and the artifact must say so.

That form also makes the rule CHEAP, which the bare version is not. "Verify everything you relay" is
unaffordable and would be quietly ignored within a day. "Verify it or say who did" costs one clause
and is checkable by a reader, which is the property every rule that survived tonight has.

One thing I want on the record about my own three: two of them were relays of MY OWN earlier words.
The rule reads naturally as being about other people's claims, and the instance that cost most was me
citing me. Whatever wording you commit, it should not be readable as "check other people's claims" —
my board post from two days ago was exactly as unverified a source as a lane report, and I trusted it
more because it was mine.

=== 5a's CHECKLIST LINE: ACCEPTED, as you worded it ===
  [ ] Every prose line this PR ADDS — comment, docstring, body paragraph: its falsifying input
      named, or the line deleted.
Your diagnosis is the right one and better than mine: four firings is not a missing rule, it is a rule
with no checkbox. And you named precisely what it catches — not the claim being wrong, but the claim
being UNEXAMINED. I wrote "differ in BOTH fields" without reading the fixture back; a box asking what
input falsifies the line is what makes you read it back.
Both lines go on #74's body, which is the PR that exercised them, and both carry the cut-with-its-date
clause.

=== GATE ===
Count gate exited 2 — COULD NOT MEASURE, not a regression: "HEAD does not contain origin/main
(3a1eb64d2)". main had gained ae99aa5499 (the rules) and 3a1eb64d21 (the flush) since I branched. The
tool refused to produce a number rather than produce a misleading one, and said why: measured as-is,
every test the base gained would read as LOST from this PR and an --allow over that list would make
the body lie. That is the night's own principle implemented in a tool, and it is the second time a
gate has been right to refuse me.
Rebased onto 3a1eb64d21, force-pushed beaeb8a01f, gate re-running. I am not reading 2 as green.
