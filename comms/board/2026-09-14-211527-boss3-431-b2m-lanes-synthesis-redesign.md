FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-b2m · in_progress · all 7 lanes received (1 file with terminator, 6 recovered verbatim from their transcripts — the Write tool is refused for subagents, so files were never possible), 24 findings -> 9 distinct defects, every one executed · the design answer:  on the copy (103 ms + add -A 174 ms on 21k files) makes membership, staged content and stages equal HEAD BY CONSTRUCTION, then  on the temp index is the positive membership check you asked for, and any non-H tag in  falls back to fresh seeding · three upstream PRs did exactly this · building now unless you say stop
AT: 2026-09-14 21:15 EDT

RECEIPT, per lane. security: FILE, 226 lines, terminator "END OF REPORT · 3 findings", count matches.
bugs, quality, tests, contracts, history, design: NONE as files — every one reports the harness's Write
tool refused ("Subagents should return findings as text"), and none worked around it. Their complete
final messages were recovered verbatim from the lanes' own transcripts on disk (subagents/*.jsonl,
last assistant message, 174/118/431/243/191/31 lines, each ending with "Profile received: 11
sections"; bugs and design carry the terminator line, the others predate the rule). That is the
lane's own text at full length, not a transport copy, so I count them WHOLE-FROM-TRANSCRIPT; if you
want them re-dispatched instead, say so. Root cause of 6ip's seven-lane instance is now known: the
final report is returned as text, and the return did not reach me — 6ip updated.

SYNTHESIS, 24 -> 9, all executed by at least one lane, cross-confirmed where noted:
 1. Force-staged ignored file captured and shipped in the diff (SEC-1). Membership class.
 2. Stop-tracking idiom (rm --cached + ignore): base captured, copy records deleted (my construct).
    Membership. Both 1 and 2 are cases of "the copy contributes membership".
 3. Unmerged entries outside `add -A -- .`'s cwd -> write-tree exit 128, capture fails every turn
    while a conflict exists; regression vs base (BUG-2, TEST-1, API-1, HIST-3: four lanes). Membership.
 4. Staged content outside cwd recorded from the index, not HEAD (API-4). Membership.
 5. Dual-flag entry tagged `s` routed to the unconditional drop; absent sparse entry recorded deleted
    (SEC-2, BUG-3, QUAL-2, TEST-3, API-2: five lanes). Flag class.
 6. Non-UTF-8 path + flag: force-remove no-ops, flag survives, edit dropped; Linux only (SEC-3). Flag.
 7. Split index: each capture writes a new sharedindex.* into the user's .git, and with a short
    sharedIndexExpire deletes the one the live index references (QUAL-1, HIST-2); the sibling copy at
    GitVcsDriverCore.ts:2331 already carries `-c core.splitIndex=false -c
    splitIndex.sharedIndexExpire=never` + `update-index --no-split-index` and a test.
 8. read-tree HEAD fallback (no index file: clone --no-checkout, worktree add --no-checkout) has no
    fixture; deleting the branch stays green (TEST-4, HIST-5).
 9. Guard mutated inert but never wider: widening the tag regex to all letters drops every H entry
    and the suite stays green (TEST-2). Plus: three upstream PRs (#8538 closed, #10725 and #10792 OPEN,
    touching the same region) all normalize the copy with read-tree --reset HEAD and fall back to fresh
    seeding on flags/sparse/split; HIST-1 names the rebase conflict risk.
 Also, corrected by the contracts lane with execution: my "sparse checkout" claim. A real cone-mode
 sparse checkout is UNAFFECTED by either seeding — `git add` is sparse-aware and declines the deletion
 with read-tree seeding too — so the only thing my "keep absent S entries" rule bought was the manual
 `update-index --skip-worktree` override, and its "restore drops the entry" parenthetical holds only
 after the bit is cleared. That rule and its claim go.

THE DESIGN, measured (git 2.52.0, this repo, 21,665 files):
 copy live index -> `-c core.splitIndex=false -c splitIndex.sharedIndexExpire=never update-index
 --no-split-index` -> `read-tree --reset HEAD` (103 ms; stat cache SURVIVES: add -A after it 174 ms
 vs ~1500 ms fresh) -> utimes(copy, live index mtime) LAST, because read-tree rewrote the file ->
 positive checks, each a fallback to `read-tree HEAD` fresh seeding when it fails:
   (i)  `git diff --cached --quiet HEAD` on the temp index — membership AND content equal HEAD, no
        enumeration of statuses (covers 1, 2, 3, 4 by construction; the check guards the construction)
   (ii) `ls-files -v -z` has no tag other than `H` — covers 5, 6 and any flag nobody enumerated
        (a mangled path still prints its tag); sparse checkouts and manual overrides therefore take the
        slow path, which is what they get on main today
   (iii) `ls-files -u` empty (reset removes stages; belt and braces, cheap)
 -> add -A, write-tree, commit-tree, update-ref. fsmonitor/untracked-cache extensions: run the temp
 index commands with `-c core.fsmonitor=false -c core.untrackedCache=false` so the copied extensions
 are inert (git then stats instead of trusting a monitor token or a cached listing; both measured
 correct tonight either way, but inert is the positive statement).
 Net: ~430 ms on this repo where it applied 140 ms before and 1500 ms on main; the flag-handling code
 (the drop step, the existence check, SEC-2/3/5/6's whole surface) is deleted, not fixed.

WHAT IT COSTS YOU TO SAY NO: (a) is still on the table and #72 then carries 1.5 s before every send.
If you approve (b)-as-above I build it in the capture tree now (lanes are done with it): the racy fix
cherry-picked, then this as one commit; tests for 1, 2, 3, 4, 5, 7, 8 and the widened guard (9) each
with the named mutant; body rewritten from scratch including the upstream PRs and the sparse
correction; then triage of the 24 by a profile-less agent against the NEW head plus blind
verification, since a redesign is the fix phase for all of them at once. Count gate after that.
