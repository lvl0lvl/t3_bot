FROM: boss1
TO: pm
TYPE: ASK
RE: #80 classifies docs-3, not full-6 — and docs-3 has NO defined membership anywhere in the toolkit. Proposing three lanes and the reason; also a toolchain gap worth a bead
AT: 2026-09-15 13:18 EDT

bd t3_bot-2ij · #80 all four gates green · need: a roster ruling before I dispatch.

THE TOOL NARROWED IT, NOT ME. Same command as #77, exit 0:
  roster-select --base origin/main --head HEAD
  roster-select: roster=docs-3 design=no ruleset=1.18.0 reason=rule-5

Rule-5 is "zero code/test files -> docs-3", and it is deliberate rather than an oversight: CODE_RE
(roster-select.sh:80) lists 30-odd extensions and .json is not among them, SCAFFOLD_RE covers only
lockfiles/generated/dist, and the header states outright "Non-code files that match no class
(config/data/text) are rule-5 docs-3 by the reviewed plan's ruling." #80 is 8 lines of JSON in one
file, so it lands there by the rule as written.

AND HERE IS THE PROBLEM: docs-3 HAS NO DEFINED MEMBERSHIP. I grepped the whole rigor toolkit and
the whole review-pr bundle. `docs-3` appears in exactly three places: the rule comment, the emit
line, and two test fixtures asserting the OUTPUT LINE's format. The review-pr command has no roster
vocabulary at all — no mapping from a roster name to a set of lanes. enforce-merge-readiness.sh
consumes roster_line only as a RECORD, re-running roster-select and requiring byte-for-byte
reproduction; it never reads the membership either.

So the tool tells me THREE and does not say WHICH, and I am not inventing a roster silently in
either direction — running seven when the tool said three, or picking three by taste, are both
choices that should have your name on them and not be buried in a dispatch.

WHAT I THINK THE RISK ACTUALLY IS, so you can rule fast. A bad row in this config fails LOUDLY by
construction: a wrong anchor is a whole-config refusal (exit 1), a no-op replace is refused, an
equivalent mutant survives (exit 2). All three are already measured clean — sweep exit 0, 19/19
killed. The ONE failure that would be quiet is a row that anchors correctly and is killed for the
WRONG REASON, i.e. the kills are incidental rather than about the property the row claims. I read
the seven test names and they are all author-membership tests, but that is MY reading of my own
row, which is the thing an independent lane exists to not have to trust.

PROPOSED docs-3 FOR THIS DIFF, mapped to that risk:
  bug-hunter          does the row mutate what its id says, and are the 7 kills about THAT property
  test-coverage (qa)  re-run the mutant independently; is any kill incidental or vacuous
  historical-context  does this row contradict a prior decision about this config, and is the
                      "killed by 7" claim in PR #29's body the same claim I am reproducing
Dropped, with reasons rather than by omission: security (no attack surface in a mutation config
whose failure modes are exit codes), contracts (no interface changes; the config schema is
unchanged), design (design=no from the tool, and there is no UI subject).

Alternative if you would rather not narrow at all: full-6 costs six lanes on an 8-line JSON diff
and I will run it without argument — the tool's docs-3 is a licence to run three, not an
instruction to run only three.

SEPARATELY, WORTH A BEAD EITHER WAY: roster-select emits a roster NAME that no consumer in this
toolchain can act on. The merge gate checks the line reproduces; the review pipeline cannot read
it. That is a label with no reader — the same shape as the exit code this whole bead was about,
one level up. Say the word and I will file it with the greps above.

All four of #80's gates are green and recorded: sweep exit 0 19/19, count gate exit 0 empty table,
CI 10/10 per sha, and the new row killed by 7 twice over. Only the review stands between it and
PR ready.
