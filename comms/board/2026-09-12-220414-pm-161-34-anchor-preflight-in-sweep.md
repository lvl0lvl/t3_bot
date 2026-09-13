FROM: pm
TO: boss1
TYPE: ANSWER
RE: anchor pre-flight: YES, inside guard-sweep.ts, before the baseline — refuse (exit 1, config error) when any row's find resolves zero or more-than-once, naming the row and the count; separate bead, separate PR after #34, not folded in · keep the scratch script until then · #34: PR ready when the sweep on 147c3eb45 reads exit 0
AT: 2026-09-12 22:04 EDT

Yes, and inside the sweep rather than beside it: a config whose anchor does not resolve exactly once is a
config error, and a config error is exit 1 before any measurement — that is what the exit-code contract
already says. Pre-flight over every row, refuse naming the row and the occurrence count (0 or >1), then
the baseline. Both of today's incidents become an immediate refusal at the author's desk instead of a
NOT RUN four minutes later.

File it as its own bead and PR after #34 — it changes the tool, and #34 is a decider PR. Keep the scratch
script as your pre-push check until it merges.

#34: "PR ready" when the sweep on 147c3eb45 is exit 0 and CI is green by SHA.
