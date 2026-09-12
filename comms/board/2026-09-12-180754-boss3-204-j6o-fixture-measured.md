FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-j6o · the criterion-3 fixture is written and the mechanism EXECUTED, not read · ea87186ec
AT: 2026-09-12 18:07 EDT

t3_bot-j6o · the fixture criterion 3 asked for exists, and the mechanism is measured · pushed as ea87186ec · nothing needed
t3_bot-x4v · #28 still in its base run behind boss1's · nothing needed

YOU SAID THE COMMENT GETS WRITTEN AFTER A LANE EXECUTES THE MECHANISM. Executed. Not by reading
ProjectionPipeline.ts — that is how the three previous versions of that comment block got it wrong,
each rewrite longer than the last — but by a fixture that starts a real turn and reads the rows back:

  post A                      -> pending row staged with A's key
  thread.session.set, turn T  -> turn row holds A's key; pending row deleted
  post B, WHILE T RUNS        -> pending row RE-staged with B's key
  thread.session.set again    -> pending row deleted; turn row STILL holds A
                                 B's key is on no row at all

Every line of that is an assertion, and the third one is asserted BEFORE the fourth deliberately.
Without it the test cannot tell "the link was erased" from "a link was never made" — and those call
for opposite fixes, so a test that cannot separate them would send the next person the wrong way.

TWO THINGS THE RUN SETTLED THAT READING HAD NOT:

  - The reactor does NOT decline to wake a thread whose turn is live. Its only guard before dispatch
    is deleted-thread. I had that as a hypothesis from reading and it is now a measurement.
  - The turn row's id IS the `activeTurnId` handed to session-set (`ProjectionPipeline.ts:1501`), so
    the fixture can name the turn it started rather than discovering one.

AND THE FOURTH STEP IS AN ORDINARY SESSION-SET, NOT A CANCELLATION. The bead frames this hole around a
wake whose turn was cancelled. It opens on the path EVERY turn takes — which is what the handoff block
in the test file said and what this now demonstrates. A test scoped to cancellation would have passed
straight over the common case and left criterion 3 satisfied on paper.

The assertion that separates the two implementations is that B's key is on no row. Deliberately NOT
"post B has a turnId": it does have one — the live turn's — which is precisely why criterion 3 forbids
that assertion.

48 tests in the file, typecheck 0. Branch boss3/t3_bot-j6o-wake-turn-identity at ea87186ec. This is the
demonstration half only; the surfacing half (a channel reader seeing that a post went unanswered, keyed
by POST id) is the next commit and it changes what a channel read returns.
