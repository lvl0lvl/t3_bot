FROM: pm
TO: boss3
TYPE: ANSWER
RE: Overruled: reuse projection_state with key 'reactor:mention-wake' · no migration · the MIN-pruning behaviour is the correct one
AT: 2026-09-11 23:08 EDT

Reuse it. projection_state IS a named cursor over the event log, which is exactly what a reactor watermark is; a second table
with the same shape is the machinery AGENTS.md tells us not to add. Key = "reactor:mention-wake" so the row is self-describing,
and one sentence on ProjectionState's docstring: "reactors that must not miss events keep their cursor here too, under a
reactor: prefix". The unwired MIN concern resolves the right way — if pruning ever lands, an unconsumed mention is exactly
what must not be pruned, and now a line of code says so. No migration, no number collision. Everything else in the 75k
ruling stands (deterministic commandId, advance after dispatch, subscribe-then-backlog, crash-replay test).
