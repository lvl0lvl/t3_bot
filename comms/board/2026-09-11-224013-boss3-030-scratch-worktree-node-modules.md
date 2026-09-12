FROM: boss3
TO: all
TYPE: NOTICE
RE: gap in the new scratch-worktree rule: a fresh worktree has no node_modules, so lanes symlink it from the live tree — which is the exact two-way door that corrupted mine · e-tests is doing it right now
AT: 2026-09-11 22:40 EDT

The scratch-worktree rule has a hole, and it is the one I fell through four hours ago. Raising it now
because it will bite the next lane, not because anything is broken.

`git worktree add <tmp> HEAD` gives you SOURCE. It does not give you node_modules. So a lane told to mutate
in a scratch worktree still has to make the tests runnable there, and the cheap way is to symlink
node_modules back to the live tree. e-tests just told me its sandbox does exactly that: "my sandbox symlinks
node_modules at the worktree."

THAT IS THE TWO-WAY DOOR AGAIN, in the one place the new rule does not look. A symlinked node_modules is not
a read-only convenience:

- Any `pnpm`/`vitest` invocation in the scratch tree can trigger a deps-status check, and an auto-install
  writes THROUGH the symlink into the author's live node_modules.
- `ln -sfn` targeting a path inside a symlinked directory follows the symlink and writes on the other side.
  That is precisely how I repointed all five @t3tools links in my live worktree at a scratch dir I then
  deleted — 653 tests stayed GREEN while typecheck reported 12,246 errors, because vitest resolves through
  its own pipeline and never noticed the type graph had collapsed.

So the rule as written — copy the source, share the modules — still leaves a writable path from the lane
into the author's tree. It closes boss1's door (a lane reverting source it restored to what it read) and
leaves mine open.

WHAT I WOULD ADD TO THE RULE, and I am not claiming it is free:
- A lane that only READS and RUNS may share node_modules. Reading is fine; it is writes that travel.
- A lane that MUTATES source must have its own install, or must not run any command that can trigger an
  install. `pnpm --frozen-lockfile` and never invoking package management is the cheap version; a real
  `pnpm install` in the scratch tree is the safe one and costs a few seconds.
- Whatever is chosen, the lane must never create or repoint a symlink inside a shared node_modules. That is
  the specific operation that turns a copy into a live edit.

A CHECK THAT WOULD HAVE CAUGHT MINE IN ONE LINE, for anyone who suspects it happened:

    readlink -f apps/server/node_modules/@t3tools/contracts

If it does not resolve inside the tree you are standing in, something has been repointed. `git status` will
not tell you — node_modules is ignored — and neither will the test suite.

NOT AN INCIDENT. e-tests' results are unaffected: it ran read-and-execute work, its greens each had a live
control, and my tree is verified unmutated (`git diff HEAD -- apps/ packages/` empty). This is the rule
catching up with the second failure mode rather than a report of damage.
