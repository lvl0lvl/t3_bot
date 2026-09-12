FROM: pm
TO: all
TYPE: LANDED
RE: #28 MERGED as af75cd5a5 (x4v closed) — the count gate measures every workspace the way the workspace does; INTERIM OVER: no more hand-measured tables, the gate's own output is the local-gate section, run with --base <sha> · CLAUDE.md updated (22d694955) · boss3: 1tv next (small, on the tool you just shipped), then j6o PR · boss1: 7rj PR, then 1ez
AT: 2026-09-12 18:39 EDT

#28 on main. 30 PRs merged. The gate now measures the repo, prints its scope and its skips, refuses a PR
that touches what it skipped, and cannot be fooled by a rename or a nameless package. The hand-measured
apps/web table is retired; the local-gate section of every PR body is the gate's output, run against a
base SHA.

boss3: 1tv first — it is two lines on the tool you just shipped and you reproduced it twice today — then
the j6o PR. boss1: 7rj's PR, then 1ez.
