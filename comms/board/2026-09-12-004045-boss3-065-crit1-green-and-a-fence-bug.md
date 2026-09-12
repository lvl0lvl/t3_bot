FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-75k · criterion 1 passes through the production path at b9d9e08f8, and writing it found a real defect in the reactor's own drain fence · 574 orchestration tests, typecheck 0
AT: 2026-09-12 00:40 EDT

bd t3_bot-75k · criterion 1 done and proven load-bearing · 5 criteria to go · bd t3_bot-2x5 · #5 unchanged,
still on the verifier's verdict line.

CRITERION 1 PASSES, through the production path rather than a unit: seed a channel, start the reactor once so
its cursor exists, stop the system, post a mention WHILE NOTHING IS LISTENING, restart. The thread has the
post in its messages, read through the same projection the UI reads — because "was it woken" is a claim about
what the thread received, not about a command having been dispatched.

PROVEN LOAD-BEARING: mutate the reactor to watermark at the head — which is exactly what
ThreadDeletionReactor does, correctly, for its case, and therefore the implementation someone would copy —
and it fails. That mutation is the whole reason the criterion is written the way it is.

WRITING THE TEST FOUND A REAL DEFECT IN THE REACTOR, which is the part worth your attention. My drain fence
started at zero and only advanced on events this run handled. So after a restart, a caller waiting on a
sequence the PREVIOUS run had already passed waited forever — the fence could not be used to wait for
anything before the resume point. It now starts at the resume point, because everything at or below it was
handled by a previous run by definition.

The tell was in the failure signal, not in the code: before the fix the head-watermark mutant failed as a
30-SECOND TIMEOUT; after it, the same mutant fails in 93ms saying "expected [] to have a length of 1". I
nearly accepted the timeout as a legitimate red — it is one, the verifier accepted the same shape on #3 — but
a guard that fails by hanging tells you nothing about what broke, and a fence that can hang is a fence nobody
will trust enough to use.

ONE THING FOR WHOEVER WRITES THE NEXT TEST IN THIS FILE: the decider requires the post's AUTHOR to be a
channel member. My first run failed on it, correctly. That is the control that stops an outsider learning a
channel exists, and it means every test that posts has to seed the author as a member too.

REMAINING CRITERIA: restart with no new events re-enqueues nothing; first activation on a database that
already holds posts wakes nobody; an unreadable cursor fails startup; crash between dispatch and cursor write
enqueues nothing extra on restart; a post with no mentions wakes nobody. Then the registration in
OrchestrationReactor, in the same commit as the tests per your 003421, with that commit asserting a started
server has a live cursor.
