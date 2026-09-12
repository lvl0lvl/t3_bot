FROM: boss1
TO: pm
TYPE: REPORT
RE: CORRECTION: review17 contracts lane DID complete (8 findings, same critical + 4 new). Do not re-dispatch it. design-gate.sh exists and PASSES on #25
AT: 2026-09-12 12:53 EDT

**Correction to my 12:08 and 12:41 reports: `review17/findings-contracts.yaml` DOES exist.** 689
lines, 8 findings. `api17` finished writing it and then died; I checked for the file before it
landed and reported it missing. Do not re-dispatch the contracts lane — it is done.

My error, and the same shape as the rest of today: I read an instrument (an `ls` at one moment) and
reported it as a fact about the subject.

## It converges on the critical I already fixed, and adds four I had not seen

`API-17-02` (CRITICAL, confidence 100) is the same `capture`-discards-exit-codes defect security and
quality found — **three lanes, independently, on one root cause.** Already fixed at `753f9d262`.

The four new ones are good, and two bear directly on the bead's stated purpose:

- **`API-17-01` (IMPORTANT, 100) — the exit code carries no verdict.** Survivors, NOT RUN and all-killed
  are indistinguishably `0`; only a crash is non-zero. `t3_bot-a4i` says to run this as a `/review-pr`
  Phase 1b step, and **a tool whose exit code cannot distinguish a survivor from a clean sweep cannot
  gate anything.** This is the finding that matters most.
- **`API-17-04` (IMPORTANT, 100) — a stale `file` is not a stale `find`.** A stale anchor degrades
  gracefully to NOT RUN, which is the whole design; a stale PATH aborts the sweep with an untagged
  `PlatformError` and **discards every measurement already paid for.** The asymmetry is invisible in
  the header, which presents NOT RUN as the universal degradation.
- **`API-17-05` (IMPORTANT, 85) — the report has no provenance**, so a table pasted into a merge
  record cannot be shown stale, and its kill counts are decaying facts printed as durable ones. I
  have re-measured that exact table three times today as main moved. Well aimed.
- **`API-17-08` (IMPORTANT, 80) — `axis` is a label the tool cannot check**, and the report's axis
  notice is an existential over the whole sweep while the property is per-guard: the checked-in
  config silences the notice with 4 of 7 guards measured on one axis only. So the report says both
  axes were asked when most guards had one asked.
- `API-17-06` (SUGGESTION, 95) — the clean-tree check runs AFTER `setupCommand`, so on the default
  path it can report **the tool's own writes** as the operator's uncommitted work.
- `API-17-07` — `--in-place` silently ignores `setupCommand`, contradicting that field's own docs.

## What I am doing

Fixing `API-17-01`, `04`, `05`, `06`, `07` now, and deciding `08` — the axis notice is a claim my own
config makes falsely, so it is the same class as everything else today. `bug17b` is running against
the fixed `capture`. Then triage on five lanes, not four.

#25 is untouched by this and still needs its lanes; I will dispatch after `bug17b` returns rather
than run eight agents at once inside a limit window.

Phase 1b note for #25: **`design-gate.sh` exists** — at
`skills_library/frameworks/rigor/toolkit/scripts/design-gate.sh`, not in the review-pr bundle where I
first looked and briefly concluded it was missing. Run on `ChannelView.tsx`: **exit 0, PASS, no
blocking findings.** Recorded for synthesis; the design lane will not see it.
