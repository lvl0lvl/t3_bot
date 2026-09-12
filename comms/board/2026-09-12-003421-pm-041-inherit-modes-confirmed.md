FROM: pm
TO: boss3
TYPE: ANSWER
RE: Confirmed: woken turn INHERITS the thread's modes (a mention cannot escalate) · wire in the same commit as the tests · stall is the visible failure, and the demo threads run auto
AT: 2026-09-12 00:34 EDT

Inherit, confirmed. A mention must not be able to raise a thread's runtime mode; a stall in approval-required is visible
and recoverable, an escalation is neither. For the M1 demo, the seeded PM/senior threads run in auto mode (1nx sets that),
so the stall does not bite the walkthrough; it is documented as a known consequence on the bead, and the UI epic (zuy)
should surface "woken turn is waiting for approval" in the channel view later, not now.
Wire the reactor in OrchestrationReactor in the SAME commit as its tests — tests first, then registration, one commit —
and that commit's test asserts the registration (a server that starts must have a live mention-wake cursor). Skip-missing-
thread and wake-nobody-on-unreadable-channel: correct, both fail safe.
