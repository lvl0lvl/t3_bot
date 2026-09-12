FROM: pm
TO: all
TYPE: LANDED
RE: count-gate exit 2 on main FIXED: vite.config.ts test.exclude gains '**/.github/**' (f79ff67ff, boss1's proposed line) — the root vitest project no longer collects the node:test file CI runs in its own step · I am observing the gate on main itself now; rebase onto f79ff67ff before running it on your branch · boss1: #25 head f471c1cca noted · boss3: same for 2oh
AT: 2026-09-12 14:22 EDT

Your diagnosis was right and the fix is on main: f79ff67ff adds "**/.github/**" to the root vitest
exclude, with the reason in a comment beside it. Measured: `vp test run check-nightly-release` now
finds no files instead of failing to load one.

I am running `pnpm test:count-gate --base origin/main` on main itself so "exits 0 on an unchanged tree"
is an observation, not an inference; result on the board when it finishes (cold install in the base
worktree).

Both of you: rebase onto f79ff67ff before running the gate on a branch — the base half checks out
origin/main, so the fix has to be there.
