FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-43k · TARGETED LANE: 4 findings, 0 logic, ALL FOUR in the comment text I wrote in the last two commits — I corrected three false claims and introduced four · all four independently verified by me just now · posting before fixing · one is HIGH
AT: 2026-09-14 20:37 EDT

The targeted lane is in, and the result is the sharpest version of tonight's pattern: the code is
clean, both guard directions are pinned, the new test does what its commit says — and every finding
is in the prose I wrote while correcting prose. I corrected three false claims in 4dd4b6eee and
b0782a702 and introduced four.

I have independently re-measured all four. Every one holds. Nothing fixed yet.

--- 1. HIGH · guard-sweep.ts:76-77 · refusal 7's parenthetical is FALSE and contradicts its own
sentence. MINE, written in 4dd4b6eee.
I wrote: "...both landing the write outside the tree at exit 0 (`t3_bot-4w2`, pre-existing — the
hard-link limb re-asks the filesystem per row and catches the same swap)."
"the same swap" is the mid-run SYMLINK relink the same sentence has just said is NOT caught. The
hard-link limb catches a mid-run HARD-link swap; it catches no symlink swap at all. The lane
executed it: a suite that replaces tracked src/thing.ts with a symlink to an outside file during the
baseline, --in-place, one row -> "killed by 1", EXIT 0, outside file holding `if (false) {`. Neither
limb fires — ls-files says 100644, stat follows the link to a target at nlink 1.
WHERE IT CAME FROM, because the mechanism matters more than the error: I compressed the security
lane's "the asymmetry is the evidence" into one parenthetical. In its report "the same swap" meant
the same swap DONE WITH A HARD LINK. In my sentence the nearest antecedent is the symlink relink.
I turned a true contrast into a false claim by shortening it.

--- 2. MEDIUM · guard-sweep.ts:805-808 · quantifier reversed, and an operational sentence that is
false. MINE, written in b0782a702 — the reachability fix itself.
I wrote "143 TRACKED source files sit at two links — everything under the three `file:`-protocol
packages", and "a row under those packages is refused today".
MEASURED BY ME just now in my own installed worktree: 145 tracked regular files under those three
packages. 143 at nlink 2, TWO at nlink 1:
    apps/mobile/modules/t3-markdown-text/scripts/sync-pierre-file-icons.mjs
    apps/mobile/modules/t3-terminal/android/.gitignore
(pnpm links what the package PUBLISHES; `scripts/` is not in the `files` list and `.gitignore` is
never packed.) So a row on either of those two IS measurable today, and my sentence says it is not.
The true direction is "all 143 are under the three packages" — which is exactly what I wrote in the
TEST file header, correctly, in the same commit. I got the quantifier right in one place and
inverted it in the other.

--- 3. MEDIUM · guard-sweep.ts:98 · a number nothing produces. MINE, and I took it from the bugs
lane's report without measuring it.
I wrote "all 19 paths across the six configs".
MEASURED BY ME with a JSON parser over the six configs: 6 configs, 98 mutation rows, 15 repo-unique
paths, 20 summed per-config unique. NO reading gives 19. The claim the number carries is sound — I
verified every path is under apps/server/src/ (zero exceptions) and all at nlink 1 — so only the
count is wrong. bugs71 said "19 paths" in its report; I put it in a source comment without checking
it, which is the propagation half of the same defect.

--- 4. LOW · guard-sweep.ts:853 · my illustration points at the wrong variable AND refutes my own
correction record. MINE, written in 4dd4b6eee.
I wrote "Measured on darwin: 2 for an empty directory, 3 with one subdirectory", and said the
previous version ("its entry count") was "wrong on APFS and ext4".
MEASURED BY ME just now on APFS: empty 2; 3 files + 0 subdirs = 5; 3 files + 1 subdir = 6; 3 files +
3 subdirs = 8; scripts/ with 52 entries = 54. Darwin counts 2 + ALL ENTRIES, not subdirectories.
Both my data points are true and NEITHER discriminates — and worse, the version I called "wrong on
APFS" is the one APFS essentially follows, off by the constant 2. I wrote a correction record that
misnames what was wrong with the thing it corrects. The branch's conclusion is unaffected.

--- WHAT I THINK THIS MEANS -------------------------------------------------------------------
Your rule was "a correction is the highest-risk site for the defect class it is correcting." I had
that rule in hand, quoted it back to you, applied it to 9e05357e3's author — and then wrote four
fresh instances into the two commits whose entire purpose was to fix that defect. Three of the four
are not subtle; #2 and #4 are contradicted by measurements I could have taken in one command, and
#3 by a number I copied instead of counting.
The thing that caught it was a lane pointed specifically at my corrections. Not the claim audit I
ran — I audited the code's OLD prose and did not re-audit my own new prose. That is the gap worth
naming: an audit that runs before the fix does not cover the fix.

--- WHAT I PROPOSE, not doing it until you rule ------------------------------------------------
One commit, four corrections, each stated as what I measured:
1. say what is true — the hard-link limb catches a mid-run HARD-link swap that `moved` is too old to
   see, and catches no symlink swap at all.
2. "all 143 are under the three packages", drop "everything under those packages", drop or qualify
   "a row under those packages is refused today" — naming the two exceptions and WHY (pnpm links
   what is published).
3. replace 19 with the measured shape: 6 configs, 15 repo-unique paths, every one apps/server/src/**
   at nlink 1. I will cite what I counted and how.
4. drop the two non-discriminating data points, say darwin counts 2 + all entries with the 5/6/8
   series, and correct the record of what the FIRST version got wrong (it was closer than I said).
Then re-gate, re-sweep, re-run #66's five — b0782a702's successor will touch the symlink suite only
if #2's test-header twin needs it, and I will check rather than assume.

I am not proposing to re-dispatch another lane after that commit. I will say plainly that I think
the honest answer is I should, by exactly the argument you made about primed lanes — but that is a
third round on prose, and the call on whether the PR carries its own correction risk indefinitely is
yours, not mine.

ALSO FROM THE LANE, both verified clean rather than assumed: M-PREFLIGHT-SKIP-GONE reds the new test
with exactly the asserted swap; both guard directions pinned (links>1 -> >2 reds 4 including the new
test; -> >=1 reds 4 different ones on the admit side); the ` T` typechange claim holds and
setupCommand is skipped in --in-place so `moved` genuinely precedes it; the nlink-Some claim holds on
darwin against the real layer. One PRE-EXISTING, not a #71 finding: a writeFileString that fails
PART-WAY (ENOSPC) leaves a truncated file with no `git checkout --`, because the restore wraps only
`runs` and sits after the write (guard-sweep.ts:1170-1178). Unreachable via the chmod-444 case the
comment names. Want a bead?

BEADS: all five I cite (icr, b7l, 6ip, d5f, 4w2) verified present in .beads/issues.jsonl on
origin/main at b717de3ec6, just now, by reading the file rather than bd show. Thank you for the
flush — and for posting your own 07w error the way you asked us to post ours.

Count gate still running at b0782a702. NOTE: origin/main moved to b717de3ec6 (your beads commit)
while it was running, so if it reports lost names in files I never touched I will rebase rather than
explain, per the rule.
