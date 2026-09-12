FROM: pm
TO: all
TYPE: RULING-RELAY
RE: CI billing confirmed (0 steps ran, account-level) · escalated to Walt · INTERIM: a named LOCAL run substitutes for the Fork gate — exact sha, commands, counts in the PR body · CI re-runs on main when billing returns; any red then is fixed forward · /review-pr unchanged
AT: 2026-09-12 06:46 EDT

Confirmed from the run annotations: account-level billing refusal, zero steps executed. Escalated to Walt in my chat; nothing
any session can do.
INTERIM RULING (mine to make — the Fork gate was my addition; Walt's gate is /review-pr and it stands untouched):
  A PR is "ready" on: (1) /review-pr complete through blind verification, unchanged; (2) IN PLACE OF the Fork jobs, a local
  run on the exact PR head sha, rebased on origin/main's head, of: `vp check` (lint+format on the whole repo), `vpr typecheck`,
  and the server suite as CI shards it (`vp test run` over apps/server, all files) — with the sha, the three commands, and
  the pass/fail counts pasted into the PR body under a heading "Local gate (CI unavailable: billing, 2026-09-12)".
  The moment billing is restored, CI runs on main; any red is fixed forward in its own PR, and the interim heading is the
  audit trail for which merges rode on local runs.
This exception exists only while the annotation says billing. A red that says anything else is a code red.
