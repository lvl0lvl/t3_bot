FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-2wm · count gate exit 0 over 14 workspaces against origin/main@b09a751ad, CI pending, sweep exited 1 for a reason I caused · the log reads: pre-flight PASSED, baseline ran, three rows killed, then the scratch worktree vanished mid-run — GuardSweepProcessError not GuardSweepConfigError, which is why those are separate types · cause: I had two sweeps running against one repo, before and after the rebase, and git worktree state is per-repository, so the first one's finalizer removed a tree the second was using · my own rule about nobody writing to a tree anyone else is reading, applied to lanes and not to two of my own background runs · pruned and re-running alone; I will not quote a partial table as the PR's evidence
AT: 2026-09-13 01:12 EDT

**Count gate green, CI pending, and the sweep died for a reason I caused — not the pre-flight and not the config.**

`t3_bot-2wm` at `bf1ed68e2`, rebased over #37.

**Count gate: exit 0**, 14 workspaces against `origin/main@b09a751ad`, desktop included, nothing lost by count or by name.

**The sweep exited 1, and the log says why it was not my change:**

```
setup: pnpm install --frozen-lockfile
baseline…
issuer-required-fails-open: killed by 1
author-allow-list-admits-system: killed by 2
author-allow-list-refuses-threads: killed by 34
could not remove the sweep worktree at /var/folders/.../guard-sweep-qt7Wsr/tree:
  fatal: '/var/folders/.../guard-sweep-qt7Wsr/tree' is not a working tree
ERROR (#1): GuardSweepProcessError: ... NotFound: FileSystem.access (...guard-sweep-qt7Wsr/tree)
SWEEP_EXIT=1
```

Read in order: the **pre-flight passed** (no config refusal), the baseline ran, three rows were killed, and then the scratch worktree **vanished underneath the run**. The error is `GuardSweepProcessError`, not `GuardSweepConfigError` — a different failure with a different tag, which is exactly why those two errors are separate types in this tool.

**I caused it: I had two sweeps running against the same repo.** One on `abc88022b` before the rebase and one on `bf1ed68e2` after, and `git worktree` state is per-repository rather than per-worktree, so the first one's finalizer removed a tree the second was still using. My own standing rule is that nobody writes to a tree anyone else is reading — I applied it to lanes and not to two of my own background runs. Pruned the stale entries and re-running the sweep alone, with nothing else touching that repo.

**What the partial run still tells me, and it is not nothing.** Three rows killed before the tree disappeared, and the pre-flight admitted the real 18-row config without complaint — which is the second direction of the gate holding on boss3's six new rows as well as my twelve. The full table follows from the clean run; I am not going to quote a partial one as the PR's evidence.

**Not blocked, no permission prompt.** The lesson is the boring one: concurrency I introduced to save wall-clock time cost more than it saved, and the failure mode it produced looked briefly like my own change breaking the tool.
