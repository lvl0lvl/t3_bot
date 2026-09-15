FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-b2m · in_progress · crossing case pinned (absent assume-unchanged reads as deleted, mutant 'keep it' red) · CORRECTION: my in-place-clear claim was wrong — measured, clearing the bit also captures the edit; the reason to drop the entry is stat-independence, comment and body fixed · racy-clean measured safe on git 2.52 · lanes start on the new head
AT: 2026-09-14 20:21 EDT

Crossing case (271): built as you described. Test "records an absent assume-unchanged file as deleted"
— README.md assume-unchanged then removed, an untracked kept.txt present; the snapshot tree is exactly
[kept.txt], the user index still says "h README.md". Mutant M-F "treat an absent assume-unchanged
entry like an absent skip-worktree entry (existence check for every flagged entry, keep it)" reds
that test and only that test. Direction stands as you read it: the tree the turn found has no such
file, and recording it absent keeps the deletion off the next turn's card.

CORRECTION, and it is mine to make before a lane finds it: in 423 I told you "clearing the bit in place
refreshes the stat cache from the edited file and the old blob survives", and you have just praised
it as the kind of thing that only comes from executing. It did not come from executing. My manual
run at 20:12 showed BOTH forms capture the edit ("CLEAR-BIT THEN ADD -A: A2" and "FORCE-REMOVE THEN
ADD -A: A2"); the twin tests were red for a different reason — my perl edit had swallowed the
template variable and the assertion ran `git show :README.md`, which reads the index. I attributed
the red to the in-place clear without re-reading the assertion. The rule I broke is the repo's own:
ask what the assertion does when the subject is absent.

What holds, and is now the comment and the body: a dropped entry is hashed unconditionally, a cleared
bit leaves the entry's stat cache in place and an edit that keeps size and mtime is trusted as
unchanged. Dropping the entry is the stat-independent form, which is the reason to prefer it.

Racy-clean, since a copied index has a fresh mtime and git's racy check reads the index file's own
timestamp: measured on git 2.52.0 with a same-second, same-size edit (file mtime == index mtime,
5 bytes -> 5 bytes). Live index: " M a.txt". Copied index with fresh mtime: captured "bbbb". Copied
with preserved mtime (cp -p): captured. Copied a second later: captured. Git smudges racily-clean
entries at write time, so the copy inherits the protection. No mtime preservation needed; stated in
the body as measured, with the git version.

Head is now the commit after 005423e47 (pushed); store 12/12, three suites green, typecheck 0 errors,
six named mutants red on their tests. Body updated. The seven lanes start on this head.
