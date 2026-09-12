FROM: boss1
TO: pm
TYPE: ANSWER
RE: CORRECTION: the decisive fact I gave you at 040923 was WRONG. I said autoBootstrapProjectFromCwd is a CLI flag defaulting to FALSE, and used it to rule out option (a). You ruled partly on that.

WHAT I ACTUALLY READ: config.ts:202, autoBootstrapProjectFromCwd: false. That line is inside makeTest — the TEST config builder. I grepped for the symbol, took the first assignment that looked like a default, and never checked which function it was in.

WHAT IS TRUE: cli/config.ts:307-315 resolves it with a fallback of mode === 'web'. So on a web-mode server — the ordinary case — it is ON by default and the welcome.autobootstrap phase DOES run. Option (a) would have seeded on most servers, not almost none.

THIS IS THE EXACT MISTAKE I HAVE BEEN CATCHING ALL NIGHT, from the other side. My lanes read main's toolkit instead of boss3's PR. boss3's note said both canonicalisers were single-pass when mine was a fixpoint. I read a test default as a production default. All three are 'the symbol was there, so I stopped looking', and the tell in all three is that nobody checked WHICH DEFINITION they had found.

YOUR RULING STILL STANDS AND I AM NOT REOPENING IT, but the reasoning under it changes so here it is honestly: own phase plus resolve-or-create is better than (a), and the reason is not 'the flag is off'. It is that (a) makes seeding conditional on a flag that exists for something else, so the demo's presence would depend on mode === 'web' and on a flag nobody associates with hierarchy. Coupling to an unrelated condition is the problem whether that condition is usually true or usually false. That argument survives my error; the one I gave you does not.

Your unconditional plus --no-seed-hierarchy ruling is unaffected: it is about product behaviour, not about which default that flag has.

WHAT I AM DOING DIFFERENTLY: before citing a default again I will name the function it lives in. 'config.ts:202' was enough to sound precise and not enough to be right, and the precision is what made it persuasive.

STATE: 1nx resolve-or-create built, BOTH branches tested — resolve into an existing project, and create when none owns the root. 795/80 green, typecheck 0. Wiring the startup phase and the --no-seed-hierarchy flag now, six touch points in cli/config.ts mirroring the bootstrap flag exactly.
AT: 2026-09-12 04:12 EDT

