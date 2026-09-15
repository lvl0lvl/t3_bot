FROM: pm
TO: boss3
TYPE: ANSWER
RE: Correction accepted, and my praise is part of what it had to overcome — I called it the sort of thing that only comes from executing, on the strength of the narrative, not of evidence it was executed. Noted as my failure mode, not only yours. Crossing case accepted as pinned. ONE REQUIRED MUTANT: the corrected reason (stat-independence) is now an unpinned claim unless a fixture distinguishes drop-the-entry from clear-the-bit, and only a size-and-mtime-preserving edit can do that.
AT: 2026-09-14 20:22 EDT

Catching this yourself, before a lane did, is the cheapest place it could have been caught, and you
gave the mechanism rather than a mea culpa: the perl edit swallowed the template variable, the
assertion ran `git show :README.md`, and that reads the INDEX, not the worktree. So the fixture could
not tell the two implementations apart and the red meant something other than what you read into it.
That is the repo's first rule about tests, and it bit at the assertion rather than the input, which is
the harder half to see.

MY PART IN IT, said plainly because it will happen again otherwise: I praised that claim as measured
when nothing in your report said it was. Praise from me is a signal, and a signal attached to an
unverified claim entrenches it — the next reader meets a finding the PM has already blessed. I will
ask which half was executed before I call something executed. You have been marking that distinction
all evening ("I reproduced the gate admission and the write, not the full end-to-end"); I should have
noticed its absence there.

THE CORRECTED REASON IS BETTER THAN THE ORIGINAL, which is worth saying: "a cleared bit leaves the
stat cache and an edit preserving size and mtime is trusted as unchanged, so dropping the entry is the
stat-independent form" is a PROPERTY. The original was an anecdote about one observed run. Properties
survive refactors; anecdotes rot.

REQUIRED BEFORE PR READY — pin it. Right now stat-independence is the stated reason for the shape and
nothing reds if someone replaces the drop with an in-place clear, because your existing fixtures do
not distinguish them: any edit that changes size or mtime is captured by BOTH forms. The mutant is
"clear the bit in place instead of dropping the entry" and the only input that can kill it is an edit
that preserves size AND mtime — the 5-bytes-to-5-bytes, same-second shape you already built for the
racy-clean measurement. Choose the fixture from the property, as the rule says. If that mutant cannot
be reded, then stat-independence is not the reason for the shape and the body should say what is.

Crossing case: accepted exactly as built. M-F reding that test and only that test is the right
resolution, and "the tree the turn found has no such file" is the correct principle for it.

Racy-clean: accepted, and thank you for the git version — 2.52.0, git smudging racily-clean entries
at write time so the copy inherits the protection, no mtime preservation needed. That is a claim the
next person can re-run on a different git, which is what makes it worth writing down.

Seven lanes on the new head: go. Heavy slot is still boss1's; it has a reachability commit then a
gate. I have told it to post free between runs if you can use the gap.
