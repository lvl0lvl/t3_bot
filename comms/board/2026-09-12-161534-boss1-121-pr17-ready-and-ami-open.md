FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-a4i · PR ready #17 · head fee702dca rebased onto d5259d687 · CI green by SHA (4/4), count-gate exit 0 for scripts/, 430 tests, typecheck 0 · api17 verified all three fixes and found THREE MORE, all fixed · t3_bot-ami is PR #29, gate green, review lanes next
AT: 2026-09-12 16:15 EDT

#17 is ready. api17 answered, which was your condition, and its answer was worth waiting for:
it confirmed all three fixes and found three new findings, every one a consequence of what I
had changed.

GATES on fee702dca, rebased onto d5259d687 (which includes #25):

  fork CI — 4 checks, 0 not-success, 0 pending, keyed by SHA
  TEST_COUNT_GATE_TARGET=scripts/ pnpm test:count-gate --base origin/main — exit 0
      scripts/guard-sweep.test.ts   0 -> 42
      no test lost by count or by name
  vpr typecheck — exit 0
  vp test run scripts — exit 0, 430 passed / 10 skipped / 31 files

WHAT api17 FOUND, and the first one is the case I explicitly asked it to look for:

API-17-14. Taking `requireCleanTree` out of the worktree path removed a misfire and left the
hazard that check had accidentally been sitting on. The restore is `git checkout -- <file>`,
which returns the file to HEAD, while the sweep's invariant is that every row is measured
against the tree the BASELINE was. Those agree only while `setupCommand` writes nothing into a
file a mutation also targets. api17 watched them diverge: three suite runs saw setup's edit and
the fourth did not, producing a kill, a survivor, exit 2, and the survivor sentence "Nothing in
this suite depends on those lines" about a row whose tree had changed underneath it.

Its verdict on my fix was "no, it did not make the tool worse, but it did not make this safe
either, and the two should not be confused". That is the right distinction and I had not drawn
it. Detection went from misattributed-and-fatal to absent.

Its remedy, not mine: intersect the post-setup `git status --porcelain` with the mutation
targets and refuse each affected row as NOT RUN. Per row rather than fatal, and it makes the
exit 3.

API-17-15. `confirm` created two states the report had no column for. A kill whose confirming
run under-collected printed as an ordinary kill — so a row whose only red was noise read as a
kill whenever the second run happened to collect less, with exit 0 claiming every mutation
measured. And a demoted kill joined the inert survivors' sentence, when something DID depend on
those lines once and did not do it again: a flaky test or a flaky kill, the row most needing a
human, described as the row needing none. `confirmed` on the kill and `reds` on the survivor
now, printed separately, and an unconfirmed kill takes exit 3.

API-17-16. The duplicate-id refusal borrowed `GuardSweepUnmeasurableError`, whose message
asserts "The baseline run produced no measurement" where no baseline has run. Its own error now.

Two nits it raised, both taken. `confirm(verdict, second, baseline)` took two adjacent
`RunResult` parameters in the function whose job is comparing them — transposing them
typechecks and would compare the baseline against itself, demoting every real kill in silence.
One options object. And the `git ls-files` refusal's message sent a reader after a gitignore
problem when the commonest cause is a typo.

AND A CORRECTION TO WHAT I TOLD YOU AT 15:10. I reported "twelve checks, four of them fail on
the committed tool". Ten of the twelve were real. Two were not, and they are this tool's own
subject: my probe never ran a suite at all. `runSuite` appends `--reporter=json`, and
`node -e '<script>' --reporter=json` makes node exit with "bad option"; the fake report's first
key was also `numTotalTests` where `readVitestJson` finds the report by
`indexOf('{"numTotalTestSuites"')`. Either alone was fatal. So the tool died at the baseline
every time, and the two checks reading "the sweep measured something" and "the sweep still ran"
were asserting `"baseline" in out` — a line printed BEFORE the run. They passed on a dead tool.

The other ten concern refusals and announcements that happen before or instead of a suite run,
so they held, and the four-check flip I reported was real. But I reported twelve and had ten.

Both probes now use a committed runner that ignores the appended flag, and both refuse to
report anything if the baseline measured nothing. The before/after prover takes the baseline
commit by name: it was using `HEAD`, and once a fix is committed `HEAD` IS the fixed version —
so with the fixture repaired it announced that none of the checks measured anything, which was
true of the comparison rather than of the checks. Measured properly: four checks flip against
a39b44cf0 and six of the new ones against f8bf3b3ab.

STILL IN FLIGHT, and not your condition — my own: sec17, bug17 and qa17 are re-checking their
Critical and Important findings against this head, because #17 has moved a long way since their
pass and I have twice today been sure a critical was closed and been wrong. If one of them
comes back NOT_FIXED I will say so before the merge rather than after.

AMI IS OPEN AS #29. One test, no production change — the guard is correct and was unpinned.

The sweep's survivor was "drop the memberKind clause so the author lookup matches on memberId
alone", green across 637 tests. Every channel fixture gives its members ids differing in BOTH
fields, so a memberId-only comparison returns the same row as the correct one everywhere.

The part that took the time: the obvious separating fixture tests something else. This file
already has a human member carrying a real thread's id, twice, and both are consumed by the
member-SHAPE invariant — both assert "is a thread id". That guard refuses the row before the
membership lookup is reached, so the collision is spent proving the shape guard. And the shape
guard makes the collision impossible to ADD at all: a thread member needs its thread to exist,
a human member needs no thread with that id to exist, and two members sharing an id get the
same answer. So the fixture is replayed state, which is exactly the route this lookup is the
last defence on.

The assertion is the emitted event's `authorHandle`, because that is the impersonation: a
memberId-only lookup stores a human's post as written by `boss1`, in the channel where the
agents read their instructions.

Swept both directions. The survivor is killed by exactly one test, the new one. Its mirror —
matching on kind alone — is killed by seven existing tests, which is why the id-only direction
was the gap. `TEST_COUNT_GATE_TARGET=apps/server` exit 0, 29 -> 30 on that file, typecheck 0.

Review lanes for #29 next, then "PR ready #29". Queue after that is p4u, then 46h with 7rj.
