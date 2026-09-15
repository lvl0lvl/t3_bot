FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-3os · the fixture I wrote for the survivor was VACUOUS and passed under its own mutant — caught by mutating, diagnosed by a POSITIVE CONTROL · root cause: a raw events.append does not move latestSequence, so nothing ran · now green clean, red under the mutant · re-sweeping
AT: 2026-09-14 22:37 EDT

Fixture built, and the first two versions of it were worthless. Reporting the mechanism because it is
a new way for a test to be vacuous and it was invisible at the assertion.

WHAT I WROTE FIRST: append a legacy `channel.post-created` event (no mentionRefs) mentioning the
HUMAN's handle on the colliding roster; drain; assert no wake. It passed.
Then I mutated the guard inert — and IT STILL PASSED. The test I had just written to pin the guard
did not pin it.

THE DIAGNOSIS, and the step that found it: a POSITIVE CONTROL. I changed the fixture to mention the
THREAD's handle instead, where a wake is REQUIRED. It should have failed. It passed too — and two
passes where one must fail means the path never ran.

ROOT CAUSE: `system.events.append` writes the event log directly, but `engine.latestSequence` reads
the engine's IN-MEMORY read model, which only `dispatch` advances. So
`latestSequence.pipe(drainThrough)` drained to a sequence BEFORE my appended event, every time. The
reactor never saw it. My assertion "no wake" was satisfied by nothing happening.

That is tonight's first rule in a test fixture: "no wake" and "no run" are indistinguishable at the
assertion, and I had written an assertion that could not tell them apart. The colliding-roster test
next to mine gets away with a raw append because it RESTARTS the system afterwards; mine appended
beside a live reactor.

THE FIX: land the legacy event while the reactor is DOWN and restart, which is the shape the FIRST
test in this file uses — the reactor resumes from its stored cursor and sees it. Now:
  unmutated ............... PASS
  inert mutant applied .... FAIL, "expected [Array(1)] to have a length of +0 but got 1" —
                            the human member woken, exactly the impersonation route the guard exists
                            to refuse
  positive control ........ FAILS when it should (thread handle mentioned -> 1 wake), which is what
                            proves the path runs at all
Three states, and the middle one is the only one that makes the test worth having.

I am recording the positive control in the commit rather than deleting it, because the NEXT person to
touch this fixture needs to know that "no wake" here has two causes and only one of them is the
guard.

NEXT: re-run the colliding-roster sweep at this head to prove the row now KILLS rather than survives —
the fixture passing is not the same claim. Then the count gate, CI, body, PR.
