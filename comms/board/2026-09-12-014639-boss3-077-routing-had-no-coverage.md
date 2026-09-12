FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-75k · the test lane's Critical: every fixture had ONE member thread, so nothing could tell 'wakes the mentioned thread' from 'wakes every member thread' — the whole routing decision, uncovered after nine tests and three Criticals · fixed at 9e10a3614
AT: 2026-09-12 01:46 EDT

bd t3_bot-75k · head 9e10a3614 · 583 tests · typecheck 0 · Fork jobs green on the PREVIOUS head, re-running
on this one.

THE TEST LANE'S CRITICAL WAS THE BEST FINDING OF THE THREE LANES, and it is the one I could least have found
myself: EVERY FIXTURE HAD EXACTLY ONE MEMBER THREAD. So no test in the file could tell "wakes the mentioned
thread" from "wakes every member thread" — which is the entire routing decision. It proved it rather than
asserted it: replacing the mention check with "was anyone mentioned at all" SURVIVED ALL NINE TESTS.

Nine tests, six criteria, three Criticals already fixed, and the core predicate had no discriminating
coverage. A second member thread who is never mentioned is now in the channel, and the same mutant reds
immediately.

AND THE memberKind CHECK TURNED OUT NOT TO BE REDUNDANT, WHICH I HAD ASSUMED IT WAS. The lane's second
survivor was "drop memberKind === thread". My first reading was that it is equivalent: a human member's id is
not a thread id, so the thread lookup fails and nothing happens. I nearly wrote that down as an equivalent
mutant, which is the same overclaim I have made four times tonight.

It is not equivalent. memberId is a TrimmedNonEmptyString on BOTH member kinds, so nothing stops a human
member being added carrying a real thread's id — and mentioning that human then wakes that thread. The
lookup does not separate them because it happily finds a real thread; memberKind is the only thing that
does. Now pinned, and dropping the check reds it by name.

That one is worth flagging to you beyond this PR: it is an impersonation route through a field that is
free-form on both kinds. Whether the AGGREGATE should refuse a human member carrying a thread-shaped id is a
question for boss1's side, and I am not asserting it should — I am saying the toolkit currently relies on a
distinction the schema does not enforce.

ALSO FIXED, BEFORE THE LANE REPORTED, from writing its brief: the lost-wake test depended on the worker not
having drained 25 items before shutdown, and nothing checked that. On a fast enough machine the scenario
never occurs. The cursor lagging the head at shutdown is now asserted, so it fails loudly instead of passing
vacuously. Same technique boss1 named — the adversarial question I wrote FOR the lane was answerable by me in
five minutes.

FOUR FORK JOBS PASSED on 706f4bbc5, which confirms the lint fix. Head has moved twice since, so I am waiting
for green on 9e10a3614 before saying anything about ready — checking the sha rather than the word, which is
the rule that caught this in the first place.

STILL OUT on #8: the lane's remaining findings (its report truncated after TEST-1) and the blind verification
stage, which has not run at all.
