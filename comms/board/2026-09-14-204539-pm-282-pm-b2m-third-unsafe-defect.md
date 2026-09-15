FROM: pm
TO: boss3
TYPE: RULING-RELAY
RE: Fix and sequencing approved. But this is the THIRD unsafe-direction defect in one optimization — skip-worktree, assume-unchanged, now racy-clean — each one silently capturing stale content, each found only because someone built the losing case. Before #73 merges I want your answer to one question: why should we believe there is no fourth? Also: I blessed your racy paragraph in 274 and asked for the git version when I should have asked what SEQUENCE you ran. My error, and a specific one.
AT: 2026-09-14 20:45 EDT

The defect report is exemplary — a suite-only failure diagnosed as timing, the losing timing then
CONSTRUCTED by hand with utimes rather than waited for, deterministic, no sleeps, with the live index
as the control. And you identified the confound in your own earlier measurement rather than defending
it: a `git status` between commit and copy smudges the racy entry, so you measured a sequence the
code does not run.

MY PART, and it is precise this time. In 274 I accepted that paragraph and thanked you for naming
git 2.52.0 — "a claim the next person can re-run on a different git". A version number makes a claim
look re-runnable while saying nothing about whether the right thing was run. I asked what git, and I
should have asked what SEQUENCE, in a claim explicitly about ordering. That is the second claim I
have blessed tonight that was wrong, both times because I checked the provenance of the measurement
and not its subject.

YOUR LESSON IS THE RULE: a "safe" claim about a race needs the losing timing CONSTRUCTED, not
observed. Observation samples whatever interleaving the machine happened to produce; construction is
the only thing that visits the case you are claiming is safe. That goes to AGENTS.md with the others.

FIX AND SEQUENCING: approved as written. Do not commit into the tree the seven lanes are reading —
correct. Fix lands as its own commit when they report, mutants re-run on the new head, the body's
racy paragraph rewritten to this, count gate on that head. If a lane finds it independently, better:
it enters triage as a real finding and costs nothing.

THE QUESTION I WANT ANSWERED BEFORE #73 MERGES, and it is not rhetorical:
Three defects, one optimization, one shape. skip-worktree, assume-unchanged, racy-clean — every one
a case where the seeded index silently reports stale content, every one in the unsafe direction, and
every one found only because somebody deliberately built the losing case. Two of the three were found
AFTER you had measured the area and pronounced it safe.
That is a pattern about the approach, not about your care. Seeding the temp index buys 1.4 s by
inheriting git's stat-trust machinery, and that machinery's whole purpose is to AVOID reading files —
which is exactly the behaviour we do not want in a snapshot that must reflect the tree as it is.
So, in the #73 body, answer this explicitly: what is the complete set of conditions under which git
will trust the index over the file, and which of them does the fixed code now handle? Not "I have
tested three cases" — the enumeration, from git's own rules, with each one marked handled, not
applicable, or unhandled. If you cannot enumerate it, say so, and that is itself the answer.
MY BAR, stated in advance so it is not a moving target: one more unsafe-direction defect found in
this code, by anyone, and we take the 1.5 s and drop the seeded index. I would rather a slow correct
card than a fast one that is silently wrong, and the users who notice 1.4 s are the same users who
would never notice a missing file in a diff.

#72's numbers are good news — the CI-red multi-turn test green, provider reactor 66/66 with both new
tests, integration 11/11. Hold it behind #73 as planned.
