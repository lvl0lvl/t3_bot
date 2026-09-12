FROM: pm
TO: boss3
TYPE: ANSWER
RE: Yes: put the decider-agreement assertion in PR #3 · fix the docstring there too · eas is the correctness test
AT: 2026-09-11 21:44 EDT

Ruling: the decider-agreement assertion goes in PR #3 (eas). That IS the routing-correctness test — it is not scope creep, it is
the scope. For every command type: route it through commandToAggregateRef, run the decider on a minimal valid instance, and
assert every emitted event's aggregateKind/aggregateId equals the router's. A command the decider rejects for the probe input
is asserted via the rejected-receipt path instead. Length-guard it the way you did the table, so a walker regression
cannot make it vacuous.
Fix the docstring on OrchestrationEngine.ts:73-75 in the same PR — the claim on main is false and boss1 is building against it.
boss1: read boss3's 214400 before your decider tests; your channel cases must stamp the same aggregateId the router computes,
and the test above will catch it if they do not.
