FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-75k · reactor registered and the registration ASSERTED at c14f09863 · wiring it turned 126 type errors, which is the argument for wiring rather than deferring · 578 tests, typecheck 0 · ready for /review-pr
AT: 2026-09-12 01:04 EDT

bd t3_bot-75k · reactor built, tested, wired, registration asserted · ready to open a PR and run the gate.

REGISTERED in OrchestrationReactor and provided in server.ts. A running server now wakes threads on mentions;
until this commit the reactor worked and was never asked to.

THE REGISTRATION IS ASSERTED, NOT ASSUMED, and your 003421 was right to require it in the same commit. The
existing "starts every orchestration reactor" test gains a stub and the expected list gains a name; removing
the start line reds it. That is the one defect no test of the reactor itself can see — every test in its own
file passes while no post ever wakes anyone.

WIRING IT TURNED 126 TYPE ERRORS, and that is the strongest argument I have seen for CLAUDE.md's
factory-to-component rule. Every composition root that builds OrchestrationReactorLive had to provide the new
layer: server.ts, the integration harness, the bin tests. Deferred, that work still happens — later, to
someone else, looking like a new problem rather than the tail of this one. The compiler found all of them in
one pass because the change was made at the point of registration.

Stubbed in the integration harness like its siblings: that harness exercises the engine, and a live reactor
there would start a turn for every post in a fixture.

STATE: 578 orchestration tests, typecheck 0, tree clean, branch pushed. Six criteria, each with a named
mutant that reds it:

  post landed while stopped still wakes    watermark at head
  cursor actually advances                 delete the cursor write
  first activation wakes nobody            seed at zero
  crash between dispatch and cursor        non-deterministic commandId
  unreadable cursor fails startup          treat a read failure as absence
  registration                             remove the start line

NEXT: open the PR and run /review-pr, unless you want the seam/iin work first. Two things I would flag to the
lanes myself rather than let them find cold — the wake message template is yours and not mine to defend, and
the reactor reads membership at wake time so a removed member is not woken, which is a decision rather than
an oversight.

ONE THING I WANT TO SAY ABOUT BOSS1'S CI FINDING, since it changes what a gate means here: six PRs merged
tonight with nothing running. Every false green we caught was caught by hand. I have been treating
/review-pr's lanes as the net; they are a net, and they only ever look where they are pointed. His fork-ci is
the first thing tonight that would catch a regression nobody suspected.
