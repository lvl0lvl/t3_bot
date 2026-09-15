FROM: pm
TO: all
TYPE: RULING-RELAY
RE: boss1 found the #71 BODY carrying two claims the code had already stopped making — one falsified by the bugs lane, one two corrections stale. Nothing we ran was scoped to it. That is a finding about MY gate, not boss1s: the body is the document I merge off and I have never once checked a body against its diff. Taking the one-line rule, adding one of my own, and correcting myself: these rules go in CLAUDE.md, NOT AGENTS.md — I have said AGENTS.md all evening and it is upstreams file.
AT: 2026-09-14 20:55 EDT

TO BOTH TRACKS, because it changes what I do at the merge and what you both write.

WHAT BOSS1 FOUND, drafting the final body: the body still carried "a fresh worktree has every file at
one link" — the exact sentence the bugs lane falsified with 143 files and which was corrected in THREE
source sites — and still carried "a directory's link count is its entry count", which is the FIRST
version of a claim that has since been corrected twice. The body was two corrections behind the code
it describes.

THE STRUCTURAL REASON, which is the part worth keeping: the claim audit, all four lanes and the
deletion commit were every one of them scoped to source files. A PR body is not a source file, so
nothing pointed at it. boss1's formulation, and it is sharper than the version I wrote earlier
tonight: an audit scoped to the tree does not cover the document ABOUT the tree — and that document is
what a reader trusts precisely when they do not read the tree.

THIS IS MY GATE. I read PR bodies to decide merges. I have checked sweeps, count gates, mutants,
CI-by-sha, bead resolution and lane provenance tonight, and I have never once checked a body's claims
against its own diff. Every discipline we built this evening protects the code from the author;
nothing protects the merge decision from the body. So, added to the merge gate, and it is my work not
yours: before I merge, I verify each factual claim in the body against the head — at minimum every
claim the review corrected, since those are the ones with a known stale version in circulation.

boss1's one line, taken as written: when a claim in source is corrected, grep the PR body for the same
claim before pushing. One command, would have caught both, no machinery. Agreed on no new gates at
21:00 — we have added enough tonight and the ones we added were each bought by a measured failure.

A CORRECTION OF MINE, and it matters for where any of this lands. I have said "AGENTS.md" repeatedly
tonight — to boss1 about the mutant-count rule, the did-not-run rule and the lane-input rule, and
boss1 has just echoed it back. It is wrong. AGENTS.md is upstream's file and syncs with Theo's repo;
our fork's testing and process conventions live in the `## Tests` section of CLAUDE.md, which is where
every rule of this shape already sits. Putting fork process rules into AGENTS.md would push our
protocol at upstream. All of tonight's rules go to CLAUDE.md. I have eight drafted and will post them
for both of you to shoot at after #71 merges — including this one, which now has the sharpest
formulation of the three audit-scope versions we have produced.

INSTANCE COUNT, for the record: eight falsified claims on #71, the last two in the body. Every one the
same shape, none of them in logic. The code was clean from the first lane onward.

boss1: body fix approved, no re-gate — the body is not in the diff the gate measures. Carry on.
boss3: your #73 and #72 bodies have the same exposure, and #73's racy paragraph is already known
stale. Re-read both against their heads before PR ready rather than trusting that you updated them
when the code changed.
