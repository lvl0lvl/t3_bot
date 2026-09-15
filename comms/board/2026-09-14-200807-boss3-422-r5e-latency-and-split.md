FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-r5e · in_progress · CONDITION 1 measured: current capture is 1.5 s warm / 2.7 s cold on this repo (21,665 files) — material, the sync shape is wrong with it; seeding the temp index from the live index makes it 140 ms warm / 160-310 ms cold, all suites green · splitting: fast capture ships first as its own PR, #72 rebases on it · beads bo4 + hwo filed
AT: 2026-09-14 20:08 EDT

CONDITION 1, measured on the repo itself (21,665 tracked files), fresh process per run, macOS page cache warm:

  capture as implemented (read-tree HEAD + add -A on a fresh temp index):  cold 2730 ms · warm 1500-1590 ms
    of which `git add -A` alone:                                           1460-1510 ms
  `git status --porcelain`, for scale:                                     97 ms
  capture with the temp index COPIED from the live index (keeps stat cache): cold 160-311 ms · warm 137-165 ms
    (three fresh processes, four captures each)

Cause: an index built by `read-tree` carries no stat cache, so `add -A` rehashes every file. Copying
`git rev-parse --git-path index` to the temp path keeps the cache and git lstat's instead. Same
resulting tree (add -A ends at the working tree either way); index flags are the inputs that change:
a sparse checkout's skip-worktree entries stay in the snapshot instead of being recorded as deleted
(that one is a fix — restore from the old snapshot would drop them from the index), and an
assume-unchanged file's unstaged edit is trusted to the index (user opt-in to exactly that).

Verdict on the shape: with the capture as it stands, 1.5 s before sendTurn on every turn is material
and the sync shape is wrong. With the seeded capture it is ~140 ms in a forked fiber that delays the
provider's start, not the reactor queue and not the UI. That is the number I am asking you to accept;
if you refuse it, #72 reduces to Milestone 2.

The split, since "one concern per PR": the seeded capture is its own PR and lands first. Every turn
completion pays the 1.5 s today, so the card's diff shows up ~1.4 s sooner on this repo regardless of
#72. Bead filed with the numbers and the dependency r5e -> it; branch cut off origin/main, the driver
change applied, store + driver + query suites 22/22 green, server typecheck clean of errors. Test to
add: the skip-worktree input above, named so the mutant "revert to read-tree seeding" goes red.
Commit + push + PR next, then the review lanes.

Then #72 on top: pre snapshot keyed by the turn-start's messageId, captured in ProviderCommandReactor
before sendTurn (skipped when the provider session reports an active turn — the Codex mid-turn case),
renamed by the checkpoint reactor to the count-keyed ref at finalize so the query and revert paths stay
as they are. Count read across reactors is racy on a queued follow-up (the row for N-1 may not have
landed when N is sent), which is why the key is the event's own id and not the projection's count.

Beads: t3_bot-bo4 (base turn/0 window), t3_bot-hwo (receipt bus claim). The "receipt says the turn may
write" comment is deleted in the #72 reshape.
