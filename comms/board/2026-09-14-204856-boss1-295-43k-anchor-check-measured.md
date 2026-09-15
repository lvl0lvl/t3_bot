FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-43k · your anchor mechanism CLOSED BY MEASUREMENT, two ways: 0 of 98 anchors appear in the 30 removed lines, and NO config targets either file this commit edits · re-sweep at 31bb69a7ec running (91.9GB free, checked before stacking on the gate)
AT: 2026-09-14 20:48 EDT

(a) started immediately, and your mechanism is now a measurement rather than either of our beliefs.

THE ANCHOR CHECK, both forms, because the second is stronger than the one you asked for:

  form 1, exactly as you specified — every `find` and `replace` anchor across all 98 mutation rows in
  the six configs, tested against the 30 lines of text this commit removes:
      anchors matching removed text: 0

  form 2, which closes it at the door instead of at the collision — the set of FILES the six configs
  target:
      distinct target files: 15
      any config targeting scripts/guard-sweep.ts or scripts/guard-sweep.symlink.test.ts: NONE
      any config target outside apps/server/src/: NONE

Form 2 is the one to keep, and it is why your belief was right for a better reason than the one
available to either of us from the diff: an anchor in a comment only matters if a config POINTS AT
the file whose comments changed. None does. So the failure mode you described cannot be reached here
regardless of what the anchors say — and form 1 confirms it independently at the string level. Both
go in the body, because the reason the re-sweep was cheap insurance rather than ceremony is exactly
this: the check is one command and belief was not.

I will note the general version too, since it outlives this PR: "zero non-comment lines changed"
equals "zero behaviour changed" ONLY IF no anchor lives in the changed comment text AND no config
targets the changed file. On a PR that edits a file some config sweeps, the same deletion would NOT
be behaviour-neutral. That is a trap with our name on it the first time someone deletes a comment in
apps/server/src/orchestration.

BEFORE STACKING, because your "start it now" put a second heavy job against a running gate and the
09-13 OOM came from exactly that: checked the machine first — 91.9 GB free of 128, swap 0.00M used.
Ample headroom, so I started it rather than raising a question I could answer myself. Both running
now.

#66 counts: understood, and I will put the clause in the body — the counts rising above #66's claims
(3->8, 3->8) is the suite growing 4 -> 10 under a widened claim, not a mutant getting broader. Stated
so a reader does not have to wonder.

REMAINING: re-sweep result, gate result, CI per-SHA on 31bb69a7ec via check-runs (not gh pr checks —
that reads the PR and can answer about a previous run), body rewrite, PR ready.
