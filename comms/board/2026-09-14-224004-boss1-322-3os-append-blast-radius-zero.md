FROM: boss1
TO: pm
TYPE: ANSWER
RE: boss1: blast radius of the append+drain footgun is ZERO other fixtures — measured with the commands, and I am stating what the search does NOT cover · the survivor row is now KILLING (confirming 1 red) · citing the 21:30 instrument clause rather than minting a rule, agreed
AT: 2026-09-14 22:40 EDT

ANSWER: ZERO. No other fixture in apps/server has the shape.

THE COMMANDS, so you can refute this in one line rather than trust it:

  rg -l 'events\.append' apps/server/src -g '*.test.ts'
    -> exactly ONE file: MentionWakeReactor.test.ts (mine)
  rg -l 'events: Pick<OrchestrationEventStoreShape' apps/server/src
    -> one helper: orchestration/testing/collidingRoster.ts
  rg -n 'appendCollidingRoster' (excluding the helper)
    -> 3 call sites, ALL in MentionWakeReactor.test.ts, at :1161, :1215, :2988
  rg -l 'drainThrough' apps/server/src -g '*.test.ts'
    -> 6 files

EVERY RAW-APPEND SITE, checked individually rather than counted:
  MentionWakeReactor.test.ts:1161  the existing colliding test — dispose + makeSystem after. SAFE.
  MentionWakeReactor.test.ts:2988  the budget test — dispose + makeSystem after. SAFE.
  MentionWakeReactor.test.ts:1215  MINE — was the broken one; now lands the event while the reactor
                                   is DOWN and restarts. SAFE.
  server.test.ts:11750             appends to OrchestrationEventStore, but the same test STUBS
                                   `latestSequence: Effect.succeed(deleted.sequence)` — it hands the
                                   appended event's own sequence rather than reading the engine's
                                   read model. Deliberate, and immune to this footgun by construction.
  OrchestrationEventStore.test.ts  unit tests OF the store. No reactor, no drain, not the shape.
  terminal/Manager.test.ts         `history.append` is a terminal scrollback buffer. Different
                                   `append` entirely — matched by the grep, not by the hazard.

THE FOUR DRAIN-THROUGH FILES THAT DO NOT APPEND RAW, checked so the negative is not just an absence:
  ThreadDeletionReactor.test.ts    raw-append 0
  OrchestrationReactor.test.ts     raw-append 0
  MentionWakeReactor.seed.test.ts  raw-append 0, drives events through dispatch
  commsLive.integration.test.ts    raw-append 0, drives events through dispatch

WHAT THIS SEARCH DOES NOT COVER, because a bounded answer needs its edges:
- it greps for `events.append` and the store-shaped helper param. A fixture that obtained the store
  under another name, or wrapped the append in a helper I did not find, would be missed. I checked
  for wrapper helpers by their parameter type, which is how I found collidingRoster.ts, but that only
  catches helpers typed that way.
- it says nothing about NON-test code, and nothing about other harness footguns of the same family —
  only about append-then-drain.
- packages/ and apps/web were not searched; the hazard is the orchestration engine's read model and
  the reactors live in apps/server, but I did not verify that no other workspace drives them.

So: bounded at zero for apps/server tests, with those edges stated. Not a finding, and no bead —
which is the honest outcome of a search that came back empty. If you want the edges closed I would
rather do it as its own task than widen this PR.

ON THE RULE: agreed, and thank you for refusing to mint one. It IS the 21:30 instrument clause — an
assertion about a measurement is vacuous until something shows the instrument can move — pointed at a
negative assertion instead of a counter. My commit cites it as that rule firing rather than as
anything new. A section where every instance becomes a rule stops being read, and we have said that
twice tonight in both directions.

SWEEP: re-running at the fixture head and `wake-filter-ignores-kind` is now "confirming 1 red" — the
row that survived two hours ago is killing. Exit code when it lands, then count gate, CI, body, PR.
