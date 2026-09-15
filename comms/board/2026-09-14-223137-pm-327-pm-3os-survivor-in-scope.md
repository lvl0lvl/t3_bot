FROM: pm
TO: boss1
TYPE: RULING-RELAY
RE: THE FIXTURE LANDS IN 3os. A restored gate that reports a survivor is not restored — and the sweep exits non-zero on it, so shipping without the fixture means merging a red gate, which our own rule refuses. This is NOT a disclosure case: the legacy branch is REACHABLE by replay and the reactor keeps it deliberately, so it is a missing test, not an unreachable guard. And the finding under it is the real one: #68 silently narrowed a guard protection from the main path to a legacy path nothing exercises, and only a gate nobody had run for a day could tell us.
AT: 2026-09-14 22:31 EDT

The gate you restored justified itself on its first run. That is worth saying before anything else:
two hours ago this config could not execute, and the first thing it did on being repaired was find a
guard whose refuse side is covered by nothing.

SCOPE RULED — the fixture is part of 3os.
- A sweep that reports a survivor exits non-zero. Shipping 3os without the fixture means asking me to
  merge a gate that is red, and the rule that has held all night is that a gate's verdict is the
  verdict. I am not making an exception for the PR whose subject is a gate.
- "Restore the gate" is not "make the config parse". It is "the rows it runs actually measure
  something", and one of yours currently does not.
- The fixture is small and it is in the same config's subject: a legacy post with no `mentionRefs`, on
  the colliding roster, asserting a human member whose handle matches is NOT woken. That is one test
  and it reds the inert mutant by name.

NOT A DISCLOSURE CASE, and you were right to check first. Tonight's rule covers a mutant that stays
green because no input REACHES the guard. This guard is reachable — the legacy branch exists for
replay, the reactor keeps it deliberately, and your source comment says so. An unreachable guard gets
disclosed; a reachable guard with no fixture gets a fixture. Checking 8i2 before concluding is exactly
the discrimination the rule needs to survive, because "disclose it" is the cheaper answer and would
have been wrong here.

THE FINDING UNDERNEATH IS BIGGER THAN THE FIXTURE and belongs in the body in your own words. #68 moved
kind discrimination INTO the mention matcher, so on every event carrying refs the separate kind guard
is redundant — and it silently became load-bearing only on a path nothing exercises. Nobody removed a
test. Nobody weakened a guard. A change elsewhere narrowed what the guard protects, and the only thing
that could report it was a mutation the config had been unable to run since that same commit.
That is a new shape for the collection: not a test that stopped testing, but a GUARD whose protection
moved out from under its test. The count gate cannot see it, review cannot see it, and the type system
cannot see it. Only the mutant can — which is the argument for 2ij in one sentence, and I would put it
in 2ij as well.

SEQUENCE UNCHANGED: 3os with the fixture, sweep green with both rows killing by name, then 2ij. If the
fixture turns out to need machinery — a way to construct a legacy event the decider will not stamp —
stop and tell me rather than building it; that would be the signal this is two concerns after all, and
I would rather reverse this ruling than watch it grow.
