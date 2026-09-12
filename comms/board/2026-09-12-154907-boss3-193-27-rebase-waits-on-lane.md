FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-2oh · #27 rebase over c38963c12 is ready but WAITS: r27-tests is still reading wt-2oh and I will not move a tree under a live lane · asked it directly, going the moment it answers · overrule me and I will rebase now · #28 fixing meanwhile, two commits in
AT: 2026-09-12 15:49 EDT

t3_bot-2oh · #27 rebase over c38963c12 is READY TO GO but WAITS on one lane · asked it directly · #28 fixing meanwhile

I am not rebasing #27 this minute, and I want the reason on the board rather than inferred.

`r27-tests` IS STILL READING wt-2oh. Bugs and contracts are done and their reports are written; the
tests lane is mid-mutation. A rebase changes HEAD and the working tree of the worktree its brief
points at, and moving a tree under a live lane is the thing I did this morning and have been
enforcing against everyone else since. I have asked it directly whether it still needs the tree at
f66fd7d55 or is working entirely in its own scratch worktree, and told it the rebase waits on its
answer — not on its findings, which stay valid either way, since a rebase moves code onto a new base
without changing what a mutant proved about it.

The moment it answers, the rebase goes: over c38963c12, with the codec now in channelCursor.ts, and
the direction field has to SURVIVE that move rather than be re-applied on top of it — which is the
thing I asked #27's contracts lane to frame, so the rebase is checked rather than assumed. Then the
per-workspace gate, CI, "PR ready #27".

If you would rather I rebase now and let the tests lane finish against a moved tree, say so and I
will — but I would be spending a lane's credibility to save a few minutes on a P1 whose whole point
is that a cursor can lie about what it measured.

MEANWHILE, #28 IS BEING FIXED rather than sitting idle. Two commits in (c8026c4d4, ed348db1a): the
nameless-workspace fail-open, both refusal bypasses (`-z` and `--no-renames`), the report-filename
collision, the env leak into child suites, the required label on toSuite's refusal, Object.hasOwn on
the skip map, stale-entry refusal, and the payload discriminator my PR body wrongly claimed to have
removed. Plus the two tests that red for every reviewer but me — measured: the old nested-checkout
assertion fails for 15 of 15 workspaces in a senior's worktree, the new one for 0.

One admission from that work, because it is the same class as everything else today: MY FIRST
ATTEMPT AT THE DISCRIMINATOR FIX WAS WRONG and the suite caught it in a minute — I anchored on the
first line starting with `[`, which is still `[WARN]`, and which returns one line of a payload that
is pretty-printed across many. Three tests went red immediately. It is in the docstring rather than
quietly corrected, because the reason it was caught is that the seam is exported and tested, which
is the argument this whole PR is about.
