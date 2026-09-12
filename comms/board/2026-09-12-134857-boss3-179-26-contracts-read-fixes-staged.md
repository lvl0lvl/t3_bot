FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-9wj · contracts lane read whole: 5 Important, 0 Critical · the gate measures apps/server ONLY (329 of ~1177 test files) — the #24 one-of-seven defect again · fixes staged not applied, 5 lanes still on the tree · need your call: widen the default or keep it and print the scope
AT: 2026-09-12 13:48 EDT

t3_bot-9wj · PR #26 · contracts lane READ WHOLE, fixes STAGED not applied · 5 lanes still on the tree · nothing needed

CONTRACTS LANE: 0 Critical, 5 Important, 3 Suggestion. Verdict "request changes on contract grounds,
the comparison logic is sound". I agree with all eight. Every one sits at the instrument's boundary
rather than in the logic, which is the right place for them to be on a policy instrument.

THE ONE THAT MATTERS MOST, and it is the #24 defect again in a different costume: C-26-01, SCOPE.
The gate measures `apps/server` and nothing else — 329 of ~1,177 test files, counted by the lane.
apps/web alone has 363 and is invisible, as are mobile, desktop, packages, infra, and — the part
that should have told me — `scripts/`, where the gate's OWN tests live. The gate cannot measure the
gate, which is why the PR body's local-gate table lists `vp test run scripts/...` and not
`pnpm test:count-gate`. The knob is an env var I documented as a SPEED override, not as the scope
control it actually is. A gate that silently covers a fraction of the rule it cites is exactly what
#24's security lane blocked me for, and I shipped it again eight hours later.

YOUR CALL, and I want it explicit rather than assumed: widen the default to the whole repo and pay
the runtime (two full runs of ~1,177 files per gate invocation), or keep `apps/server` and make the
scope a first-class printed term. I have staged (b) — the table now leads with "measured
<target> against <base>" so a pasted PR-body table records its own scope, and the Usage block names
the env var as the scope knob with the file counts in it. Say the word and I will do (a) instead.

MY OWN PROBE, on the one question the lane routed as unverified: the runner's JSON. Two results,
both executed. "Skipped is a decrease" is TRUE — a skipped test really does come back
`status: "skipped"` and the filter really does drop it. But A FILE THAT FAILS TO LOAD comes back
with `assertionResults: []` and `status: "failed"`, and I read that as ZERO TESTS. So a bad import
in HEAD makes my gate print "coverage went DOWN" and list every test in that file as lost, when the
truth is that head does not compile; in BASE it reads as a gain and says nothing, so the gate
silently measures less than it claims. That is the same misdiagnosis as the lane's CI case, reached
by a second route, and it is mine. Sent to the bug lane as data rather than as a verdict, since I
wrote the code.

STAGED, NOT APPLIED: scripts/fix26a.py in my scratchpad covers C-26-02 (exit code 2 for
cannot-measure, and the temp-dir leak from `worktree add` sitting outside the try), C-26-03 (an
allow is now per-TEST-NAME, because file-level allow meant one explained deletion blanket-allowed
an accidental one — the lane executed that and the gate exited 0), C-26-04 (`import.meta.main`; the
filename match meant a rename turned the gate into a silent exit 0), C-26-06 (unknown options now
throw), C-26-07 (the key domain stated on `Suite`, plus a cwd-is-repo-root check), C-26-08 (child
process logs off stdout, and a success line that states what was measured and its floor), and the
load-failure hole above.

I AM NOT APPLYING IT YET, and that is deliberate: five lanes are still reading that worktree, and
editing a tree someone else is reading is the rule I have been enforcing on everyone else all day.
It applies to me first. When they are off it: apply, rebase onto c611bfb3f, re-run, CI, "PR ready".

FILED: t3_bot-3r8, P2, assigned to you, blocked on 9wj — CLAUDE.md:74 still says "No script
enforces this yet"; the lane was right that a deferral living only in a PR body has no owner once
the PR merges. I did not edit CLAUDE.md and will not. The replacement text should gain a scope
sentence and the exit-code line before it becomes policy.
