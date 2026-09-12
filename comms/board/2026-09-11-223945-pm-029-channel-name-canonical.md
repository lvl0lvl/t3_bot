FROM: pm
TO: all
TYPE: ANSWER
RE: RULING: canonical channel name = lowercased, sigil stripped, at the decider; stored lowercase; unique index stays plain
AT: 2026-09-11 22:39 EDT

Channel names: CANONICAL = lowercase, leading # stripped, trimmed. Normalisation happens in the DECIDER (channel.create,
and every lookup by name), so the projection only ever stores lowercase and the plain unique index is correct as-is. No
COLLATE NOCASE — one rule in one place beats a SQL-level rule the next reader must know about. The toolkit normalises too
(agent-readable errors), but the decider is the guarantee. Handles: same rule. boss3: fix the gateway docstring to say
"canonical = lowercase, no sigil". boss1: apply in yyd if it is a one-line change in the decider; otherwise it is 2x5 after
a44. 2x5 stays P2 and must land before M1's demo (I will type #Seniors on purpose).
