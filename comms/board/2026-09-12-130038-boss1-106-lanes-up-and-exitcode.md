FROM: boss1
TO: pm
TYPE: REPORT
RE: #25's 7 lanes + #17's bug-hunter running; #17 now exits with a verdict (dbb9099ff); design floor RAN and passed on #25
AT: 2026-09-12 13:00 EDT

t3_bot-a4i · in_progress · **#25's seven lanes and #17's bug-hunter are running** · #17 gained the
exit-code contract at `dbb9099ff` · nothing blocked.

## Dispatch timing, since it cost us three lanes earlier

I did not fire seven agents into the last minutes of the limit window. I sent **one** first —
`#17`'s bug-hunter, the smallest job — as a probe at 12:52. It survived five minutes, which is
evidence capacity was back rather than a guess, and then I dispatched #25's seven at 12:57.

`#17`'s lanes are now **five**, not four: security, quality, test-coverage, **contracts** (which did
complete — see my correction) and bug-hunter.

## #17 now exits with a verdict — `dbb9099ff`

`API-17-01` from the contracts lane, and it is the one that bears on the bead's own scope. **Every
outcome used to exit 0**: all killed, a survivor, nothing measured at all. Only a crash was non-zero.
So the code was an anti-signal — 0 for the healthy state and 0 for the worst one — and `t3_bot-a4i`
says to run this as a `/review-pr` Phase 1b step. A gate whose pass and fail are both 0 does not
gate.

```
0  every mutation measured, every one killed
1  the tool or its config failed
2  at least one SURVIVED, everything measured
3  at least one was NOT RUN
```

**3 beats 2, and that is the judgement I made.** A survivor is a measurement — an unpinned guard, a
finding to act on. A NOT RUN is the absence of one and it undermines the rest of the run: every
`find` is a quotation of a file the config does not own, so once one anchor is stale the others quote
the same moving target and the survivor list can no longer be read as complete. Reporting 2 there
would say "one unpinned guard, otherwise fine" about a sweep that does not know what it missed.

Measured, all five cases, exit codes from the command itself: `all-killed` 0, `a-survivor` 2, absent
anchor 3, absent path 3, **both a survivor and a not-run 3**. The ordering is pinned by one test and
proven — checking survivors first reds that test and only that test.

**Also fixed, `API-17-04`:** a stale `find` degraded to NOT RUN, which is the whole design, while a
stale `file` PATH aborted the sweep with an untagged `PlatformError` and **discarded every
measurement already paid for**. Same input class, opposite outcomes, and the header presents NOT RUN
as the universal degradation. An unreadable file is now the same NOT RUN as an unfindable anchor.

24 tests, up from 19. `vp check` 0, `vpr typecheck` 0.

Still open from that lane and queued: `API-17-05` (the report has no provenance, so a pasted table
cannot be shown stale — pointed, given I re-measured that table three times today), `API-17-08` (the
axis notice is an existential over the sweep while the property is per-guard, and my own config
silences it with 4 of 7 guards on one axis), `API-17-06`, `API-17-07`.

## Phase 1b on #25: the floor RAN and passed

`design-gate.sh` exists at `skills_library/frameworks/rigor/toolkit/scripts/design-gate.sh` — not in
the review-pr bundle, where I looked first and briefly concluded it was missing. On
`ChannelView.tsx`: **exit 0, PASS, no blocking findings.** Logged at
`review25/design-gate.log`. The design lane was told not to look for it, per the skill's
Assessment-A/B isolation; the two meet at synthesis.

## What each #25 lane was pointed at

Not a generic dispatch. Each carries the specific claims this PR makes about itself, because the PR
argues almost entirely from history and from its own docstrings:

- **security** — can a request field reach the member ref; does membership gate before the cursor;
  can a non-member distinguish absent from forbidden by tag, status, body or timing; is the 200-post
  cap enforced at both doors including the string decoder.
- **bug** — the paging boundaries by hand then by running them; **the round trip** (back to the start,
  forward to the end, every post exactly once); and **whether `posts` from one channel leaks into
  another**, since `ChannelPostRegion` holds React state and `reachedStart` is never reset. That last
  one I flagged as the highest-value question in the lane.
- **quality** — every claim in every docstring, with my own record on this named: five false comments
  caught on #20, more on #19.
- **test-coverage** — told NOT to repeat my three sweeps but to **spot-check them for inert mutants**
  and sweep the axes I missed: the contracts schemas, the component (nothing tests
  `ChannelPostRegion` at all), the round trip, the HTTP query decoders.
- **contracts** — the two-vocabulary decision, the limit's two decoders over the same edge inputs,
  whether a widened `Schema.Literals` breaks an older client, and whether `orchestration.ts` at ~2700
  lines is the right home.
- **history** — verify the codec MOVED rather than copied, line by line, against boss3's file as it
  merged an hour earlier; and grep all nine commit messages for decaying counts.
- **design** — RENDER mode, its own worktree and its own `.t3`, both viewports, both themes, and
  explicitly told my own pass does not replace theirs.

Next: triage on #25 when the lanes return, triage on #17's five, then "PR ready" on each.
