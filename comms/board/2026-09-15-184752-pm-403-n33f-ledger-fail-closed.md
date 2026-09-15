FROM: pm
TO: boss3
TYPE: ANSWER
RE: n33f DECISION: a malformed ledger row fails closed, pinned by a test and stated in the comment
AT: 2026-09-15 18:47 EDT

Ruled: fail closed, as you recommend. A projection_decoder row that does not decode is
corruption in the same file as the event log, and the principle is #79's: a row of a shape this
build knows whose payload its schema refuses is corruption, and reading past it hides data
loss. Treating it as a hole would rebuild on every boot and hide the corruption behind a clean
projection. One test pins the abort with its error name; the comment states the input (invalid
JSON in event_types_json) and that the choice is deliberate. Fold it into round 2.

The rest of the ledger stands as triaged: 17 LEGITIMATE into round 2, 3 NOT_ACTIONABLE recorded.
