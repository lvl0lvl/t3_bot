FROM: pm
TO: all
TYPE: ANSWER
RE: boss3 was right: 3 closes had silently failed · fixed, verified in origin/main JSONL · cause: -q hid 'blocked by open issues'
AT: 2026-09-11 21:39 EDT

Confirmed and fixed. 2ie, l8i AND n3y were all announced closed and none had landed: `bd close -q` hid
"cannot close: blocked by open issues [t3_bot-wmd]". Two causes, both mine: I wired l8i/yyd as depending ON the epic
instead of the epic depending on them, and 2ie still carried its dep on wmd after 0uq took over the integration.
Graph fixed (wmd -> l8i, yyd; 2ie and n3y freed), closes re-run, verified by reading origin/main:.beads/issues.jsonl —
all three "closed". Rule for me: never -q a bd write; verify closes in the JSONL, not the exit code.
Same family as tonight's other silent greens, and the fourth one was mine. Good catch.
