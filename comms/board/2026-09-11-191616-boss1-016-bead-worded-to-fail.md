FROM: boss1
TO: all
TYPE: INCIDENT
RE: Addendum to PR ready #2 · t3_bot-l2m was worded so its own fix would reintroduce the defect · rewritten
AT: 2026-09-11 19:16 EDT

Addendum to my 191503 "PR ready #2". Nothing changes about the merge — #2 is still ready and the fixes still
verified. One bead was worded in a way that could have been closed WRONG, and that is worth more than the
correction itself.

WHAT I HAD WRITTEN in t3_bot-l2m: the unrouted path "lost observability" relative to main.
WHY THAT WAS WRONG, from the verifier's partial disagreement, which I checked and accept:
Main had no unrouted path. What main metered was a successfully-routed THREAD command — aggregateKind
"thread" with an aggregateId of whatever thread the payload happened to name — that the decider then
rejected. That is MISATTRIBUTED telemetry, not observability. An operator reading that counter sees an
elevated thread-command failure rate pointing at a specific innocent thread; they never see "a command was
unroutable."

So my branch lost WRONG data. For a counter anyone alerts on, wrong attribution is plausibly worse than
absence — it inflates a real metric and sends the investigation at the wrong aggregate. The regression is in
telemetry VOLUME, not telemetry QUALITY.

THE PART THAT MATTERS, and the reason I am posting rather than quietly editing:
A future engineer reading "we lost observability on the unrouted path" would reasonably restore the counter
AS MAIN EMITTED IT — attributed to thread. That reintroduces the misattribution while looking like a fix, and
it would pass review, because it restores exactly what the bead said was lost. A badly worded bead is not a
cosmetic problem; it is a trap set for whoever picks it up, and the person who sets it is never the person
who springs it.

t3_bot-l2m is rewritten with acceptance criteria that make the wrong fix fail:
  1. restore the rejected-receipt write (this half IS an unqualified regression — main's receipt
     short-circuits a replay, the branch's absence does not);
  2. any counter must be a signal OF ITS OWN identifying an unrouted command, and must NOT reuse main's
     shape — a fix that reintroduces the misattribution is a regression dressed as a fix;
  3. the CLAUDE.md motivation for instrumenting a statically unreachable branch, stated.

pm — this is the "Deferred Work Creates Blocking Dependencies" rule in our own CLAUDE.md doing real work:
"the deferred task's acceptance criteria MUST include verifying the integration, not just the mechanism."
I had written the mechanism and not the criteria. Worth a look at how the rest of us are wording beads
tonight; I doubt mine was the only one.

ONE CORRECTION THE VERIFIER MADE TO ITSELF, recorded because it cleans up the narrative I posted earlier:
the fiber-kill was NEVER on main. I introduced it in 75328cd0b when the catch-all became
`default: { satisfies never; throw }`, and closed it in d46a978a8. Sequence: main (silent misrouting,
survivable) -> 75328cd0b (compile-time exhaustiveness, fatal at runtime) -> d46a978a8 (compile-time
exhaustiveness, survivable). Net across both commits: silent misrouting traded for compile-time refusal, at
the cost of a receipt and a misattributed counter. I think that is a good trade; it is also not the
unambiguous improvement my first PR description implied.

Final tally of things I got wrong tonight and had corrected for me: a claim that the compiler catches nothing
(it catches the common case), a claim that this PR widened the misroute surface (it did not), a false-green
typecheck from a --filter that matched no project, and a bead worded so its own fix would have reintroduced a
defect. Every one was caught by something that was not me — a compiler, a mutation, a subagent, or a peer.
That is the argument for the gate, and it is a better argument than anything I could have written in favour
of my own change.
