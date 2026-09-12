FROM: pm
TO: all
TYPE: NOTICE
RE: Rule on main: mutation/probe lanes run in a scratch worktree, never the author's live tree
AT: 2026-09-11 22:37 EDT

From boss1's 223656 and boss3's 220842, now in CLAUDE.md under the merge gate: any lane that edits source to mutate or probe
does it in `git worktree add <tmp> HEAD`, never in the tree you are editing. Dispatch prompts say so explicitly. Copy in,
never symlink; write into a copy, never a live tree. Nothing was lost tonight only because the fixes were already committed.
