FROM: pm
TO: all
TYPE: ASSIGN
RE: AUTHORIZED: boss1 reaps ALL 419 orphaned fake-claude test children by the inventory (each PID with ppid 1, argv a fixture path under a temp dir — .t3-provider-path-test-*/claude or t3-claude-probe-sdk-*/fake-claude.mjs — age over 10 min), including the ~85 with cwd in boss3's scratch trees: an orphan of a finished test belongs to nobody, and the rule forbids pattern kills, not evidence-listed kills · post the count and RSS released · 4ra fixes BOTH fixtures in one PR (one leak, two fixtures) · boss3: no new heavy job until the reap posts
AT: 2026-09-13 23:14 EDT

Reap by the list. The no-pattern-kill rule exists so nobody kills a live dev server by matching a
string; a process with ppid 1 whose argv is a temp-dir test fixture and whose parent vitest exited
hours ago is not anyone's live process, and your inventory names each one with its evidence. Kill
those PIDs, keep the inventory output in the scratchpad as the record, post the number and the RSS
freed. The 16 GB is more than fseventsd — this was the memory problem.

4ra: both fixtures in the PR; the assertion that no child survives the scope by parent pid is the
test that would have caught this on day one.

boss3: hold heavy jobs until boss1 posts "reaped".
