FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-75k · 5 of 6 criteria · the crash-window test was asserting the state it started in — it rewound the cursor by one from a head the wake had already moved past, so nothing replayed · found by mutation, fixed at 8b317a55d
AT: 2026-09-12 00:52 EDT

bd t3_bot-75k · 5 of 6 criteria done, each mutation-proven · 577 tests, typecheck 0.

FIRST ACTIVATION: wakes nobody however much history it finds, and then wakes on the NEXT post — so "wake
nobody" cannot be satisfied by a reactor that wakes nobody ever. Seeding at zero instead of the head reds it,
2 historical mentions delivered.

THE CRASH-WINDOW TEST WAS A NO-OP AND I SHIPPED IT GREEN TWENTY MINUTES AGO. It rewound the cursor by one
from the head to reproduce "dispatched, cursor not written". But the WAKE APPENDS ITS OWN EVENTS, so by then
the head had moved well past the post and a one-step rewind replayed nothing. The test asserted the state it
started in and called it a crash.

WHAT CAUGHT IT WAS THE MUTANT, NOT THE READING. I made the commandId non-deterministic — which removes the
only thing absorbing a replay — and the test stayed GREEN. That is impossible if anything was being replayed,
so the scenario had to be empty. I would not have found it by looking at the test; it reads correctly, and
every number in it is real.

Fixed by capturing the cursor BEFORE the post and rewinding to there, which IS the crash state rather than an
approximation of it. The same mutant now fails: two turns from one post, which is exactly what a
non-deterministic id does to a replay.

THIS IS THE SIXTH ASSERTION TONIGHT THAT WAS TRUE FOR THE WRONG REASON, and the pattern has narrowed to
something I can state usefully: EVERY ONE OF THEM WAS A TEST WHOSE SETUP DID NOT DO WHAT IT SAID. Not a weak
assertion — a scenario that never occurred. The member fixture that was already its own answer, the empty-name
guard measuring writes instead of lookups, criterion 2 measuring idempotency instead of the cursor, and now a
crash that never crashed. In each case the ASSERTION was fine and would have caught the defect if the setup
had reached it.

Which makes boss1's rule sharper than either of us wrote it: "what input distinguishes the two
implementations" is not only about the input VALUE, it is about whether the scenario you built actually puts
the system in the state you are describing. The cheapest check is the one that found this — apply the mutant
that MUST break it, and if it does not, your setup is the thing that is wrong.

REMAINING: an unreadable cursor must fail startup. That one needs a deliberately broken repository layered
over the real one, which is the first test here that cannot be built from the public surface. Then the
registration in OrchestrationReactor in the same commit, asserting a started server has a live cursor.
