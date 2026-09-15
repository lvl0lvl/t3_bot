FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-b2m · in_progress · SECURITY LANE (file, terminator ok, 3 findings, verdict BLOCK): SEC-1 a force-staged ignored file (git add -f .env) is in the live index but not HEAD, so the copied index captures it and getTurnDiff ships it to clients — base excluded it; the body's 'resulting tree is the working tree either way' is FALSE. SEC-2 an entry with BOTH skip-worktree and assume-unchanged is tagged lowercase 's', skips the existence check, absent sparse file recorded deleted. SEC-3 non-UTF-8 path + flag (Linux only): the drop step no-ops on the mangled path, flag survives, stale content — a FOURTH unsafe-direction case by your bar · your ruling needed
AT: 2026-09-14 21:11 EDT

Receipt: security = FILE, 226 lines, terminator "END OF REPORT · 3 findings", count matches, read whole.
Every finding executed in temp repos (scripts e1-e12 in its lane dir), none reasoned. Other six: no file
yet (asked at 21:07, terminator rule 21:09).

SEC-1 (conf 85, impact 4). `git add -f .env` on an ignored file: base's read-tree HEAD never had the
entry and add -A does not add ignored paths, so base's snapshot excluded it; the copied index carries
the entry, add -A refreshes it, write-tree commits it, and the first turn's diff (from HEAD) ships
"+AWS_SECRET_ACCESS_KEY=..." over the WebSocket via getTurnDiff/getFullThreadDiff, remote clients
included; the blob stays in .git/objects under refs/t3/checkpoints. Executed base vs head on the same
repo. This is the answer to the adversarial question I posed in the body and it is not a flag case.
SEC-2 (conf 95, impact 3). `git ls-files -v` lowercases the tag when assume-unchanged is set, so an
entry with both flags prints `s`; my classifier routes on the literal `S`, so `s` takes the
unconditional-drop branch and an absent sparse file is recorded as deleted (phantom deletion on the
card). Fix is a case fold plus a fixture with both flags. Restore is unharmed (measured).
SEC-3 (conf 88, impact 3). Index paths are bytes; the runner decodes with a non-fatal TextDecoder;
a latin-1 path is re-encoded with U+FFFD, `update-index --force-remove` no-ops on it at exit 0, the
assume-unchanged flag survives into the temp index, and the turn's edit to that file is dropped from
the card. APFS refuses such names, so unreachable on macOS; reachable on a Linux `npx t3` host.

The class behind SEC-1, and it is broader than one file: the copied index contributes MEMBERSHIP, not
only stat data. Base's entry set is HEAD plus what add -A adds; the copy's is the live index. They
differ wherever `git diff --cached HEAD` is non-empty in a way add -A cannot repair: staged additions
that are ignored (SEC-1, captured when base would not), and HEAD entries removed from the index with
the file kept and ignored (`git rm --cached x; echo x >> .gitignore`, the stop-tracking idiom: base
captures it, the copy records it deleted). Not yet built; I will build both before claiming either.

Two ways out, your call, my recommendation second:
(a) DROP the seeded index, take the 1.5 s. Your stated bar was one more unsafe-direction defect, and
    SEC-3 is one, narrow (Linux + non-UTF-8 name + flag) but stale content.
(b) KEEP it under one principle that closes the class rather than the instance: the copy supplies
    only the stat cache; membership follows base. Concretely, after the copy: drop flagged entries
    (case-folded tag, SEC-2); `git diff --cached -z --name-status HEAD` on the temp index, force-remove
    A-entries that `check-ignore` says are ignored (SEC-1), `git add -f` D-entries whose file exists
    (the stop-tracking idiom); then add -A; then RE-LIST and if any flagged entry survived (SEC-3, or
    a class nobody enumerated), discard the temp index and seed with read-tree HEAD — slow and
    correct instead of silent and wrong. That fallback is the structural answer to "is there a
    fifth" for the flag class; the diff --cached statuses (A/D/M/R/T/U) are git's finite list for the
    membership class, so each gets a test or a measured "same as base".
I recommend (b) because the 1.4 s is paid on every turn by every user and #72's shape needs it, and
because (b)'s two rules are derived, not discovered — but I have now been wrong about this
optimization four times, and you set the bar in advance so it would not move. Say which.

Either way: the count gate waits (there is no final head yet), the enumeration in the body grows two
rows, and the body's equivalence sentence is deleted whatever we choose. TTFT rerun in progress.
