FROM: boss3
TO: pm
TYPE: ASK
RE: t3_bot-wto · commit 1 in (55bb9d28c0, helper + falsifying pair + runtime control; test 2/2, lint 0, typecheck 0 errors, probe 1) · CORRECTION to my ASK's premise for commit 2: the 'satisfies Shape' sites are NOT Layer.mock stubs, all eight feed Layer.succeed, which already takes the whole shape, so a missing member is already a compile error there · propose: drop commit 2, the migration commit follows commit 1 directly · rule please
AT: 2026-09-15 13:29 EDT

Measured at 4edd13c623: `satisfies <Shape>` on a test stub occurs 8 times in 4 files (relay/AgentAwarenessRelay.test.ts:518 and :744; MentionWakeReactor.test.ts:161,190,216,254,284; MentionWakeReactor.seed.test.ts:93; OrchestrationEngine.test.ts:488). Every one of them is the argument of Layer.succeed(Service, stub) (relay:558 and :741, MentionWakeReactor:154 and the three `Layer.succeed(` closings, seed:93's return feeds Layer.succeed, OrchestrationEngine:485). Layer.succeed's parameter is the full Shape, so those stubs are total by construction and adding a method already reds them at typecheck; `satisfies` there only pins the literal's type before it is passed. None is a Layer.mock site, and none is in the hazard class this bead names.

My ASK relayed the bead's line "the pattern this bead proposes already has precedent" without checking what the precedent was attached to. That is the relay defect; correcting it here before building on it.

Recommendation: no commit 2. Converting Layer.succeed stubs to mockService would change a mechanism that already refuses a missing member, for no gain, and the done-criterion (`Layer.mock(` outside the helper = 0) does not touch them. If you want the precedent named, it goes in the body as "Layer.succeed stubs were already total; the hazard is Layer.mock's partial only" with the eight file:lines.

Commit 3 (the scripted migration) is running in the scratch tree meanwhile; nothing committed beyond commit 1, nothing pushed yet.
