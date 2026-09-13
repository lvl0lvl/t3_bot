FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-2wm · DIAGNOSED: the design is sound, the broken thing was my probe · ordering measured by line number — refusal at 795, baseline at 801 · verdict logic against the real sources: every real row applies, one broken row returns exactly that row with 0 occurrences · and the cause I most feared is RULED OUT — a fresh worktree after pnpm install has 0 porcelain paths, so moved is empty and the setup-written skip cannot swallow the row the pre-flight exists for, which means my two skip tests pin correct behaviour not a defect · the 30 minutes was my probe capturing output instead of streaming it, so it could not tell stuck from working — same defect as a log line printed before the run · re-running with streaming and timestamps; the wall-clock saving stays UNCLAIMED until measured
AT: 2026-09-12 23:48 EDT

**Diagnosed, and the design is sound — the broken thing was my probe, not the pre-flight.** Three questions, each measured rather than argued.

**1. Ordering, by line number in the shipped file.**

```
moved read (git status --porcelain)   line 755
pre-flight loop                      line 776
unappliableRows call                 line 786
config refusal                       line 795
Console.log("baseline…")             line 800
runSuite baseline                    line 801
```

The refusal is nineteen lines above the baseline call. That is not proof the process exits there — an exception could be swallowed — but it settles the placement question I said I would not argue from the code: I can now argue it from the code *and* from the two measurements below.

**2. The verdict logic against the real sources.** Every row of the checked-in config applies cleanly; the same run with one deliberately broken row returns exactly that row, naming zero occurrences. So `unappliableRows` sees what I claim it sees when fed the real files rather than a fixture.

**3. The candidate cause I was most worried about is ruled out.** I feared the setup-written skip was swallowing the row the pre-flight exists for — which would have made my two "deliberate skip" unit tests pin a defect. Measured: a fresh detached worktree at HEAD, `pnpm install --frozen-lockfile` run in it, then `git status --porcelain`:

```
before setup: 0 paths
after setup:  0 paths, install exit 0
mutation targets among them: NONE
```

The install writes nothing git-visible, so `moved` is empty and the skip cannot swallow anything. The skip tests pin correct behaviour. I removed the probe worktree afterwards.

**So what was the thirty minutes?** Not the pre-flight failing to fire. My probe captured the subprocess's output instead of streaming it, so it printed nothing until the process ended — and two `pnpm install`s were running concurrently (my worktree's and the sweep's setup in its scratch tree), which is the likeliest reason it sat. A probe that shows nothing until it finishes cannot distinguish "stuck" from "working", which is the same defect as a log line printed before the run: I built an instrument that could not tell me the thing I was asking it.

Re-running it now with output streamed and both timestamps recorded, so the number in the body is measured. **Until it reports I am claiming only what the three measurements above support: the refusal is placed before the baseline and the verdict is correct. The saving in wall-clock time stays unclaimed.**
