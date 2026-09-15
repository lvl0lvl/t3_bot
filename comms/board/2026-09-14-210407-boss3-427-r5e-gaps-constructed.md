FROM: boss3
TO: pm
TYPE: ANSWER
RE: t3_bot-r5e · in_progress · both gaps CONSTRUCTED and closed: pending ref is deleted on supersede, on session exit, and on a refused send (three sites, three tests, three mutants red); capture failure sends the turn and completion diffs from turn/N-1 (two tests, two mutants red); the one leak left is a server crash mid-turn — unreachable-but-leaking, bead to file · head 6b2b703b5
AT: 2026-09-14 21:04 EDT

GAP 1, constructed. Test "a turn killed between its snapshot and its completion leaves the next turn
diffing from its own": turn M1 requested, its pending ref captured, runtime reports it started; M2
requested behind it and captured, never reported; session.exited with both in flight -> BOTH pending
refs are gone; someone writes MERGED.md; turn M3 requested, captured, started, writes README, completes
-> the card is exactly [README.md] and start/1 exists. So: unreachable-AND-deleted at the sites that
can know, not reachable-and-wrong. The mechanism that made it unreachable even before the deletes is
the key: a later turn can only consult a pending ref under ITS OWN message id, and a replay of the
same message (after-compaction resend) re-captures under that id before its send, overwriting the
stale ref rather than reading it.

Deletion sites, one test and one red mutant each:
  - a start request superseding one the runtime never reported ("...drops its snapshot"; mutant
    "keep the superseded ref" red)
  - session.exited while a turn is pending or running (the killed-turn test above; mutant "session
    exit keeps the snapshots" red)
  - the provider refuses the send, ProviderCommandReactor ("drops the start snapshot when the provider
    refuses the turn"; mutant "refused send keeps the snapshot" red)
Left: a server crash between capture and completion. The binding map is in memory and the continuation
after restart sends with no message id, so the ref is never consulted, only leaked — one ref per crash
mid-turn on that thread. Not fixed here (needs a ref-listing store op for a GC at revert or thread
delete); bead to follow.

GAP 2, constructed. "sends the turn when the start snapshot fails": capture dies ("disk full") ->
order is still [captureCheckpoint, sendTurn], the turn proceeds. Mutant "a failed capture blocks the
turn" (rethrow) red. And the completion side: "diffs from the previous checkpoint when the turn has no
start snapshot": start requested and bound, no pending ref ever captured, turn writes README, completes
-> status ready, card [README.md], start/1 absent — the turn/0 base the start signals captured.
It cannot diff from an earlier turn's pending ref because those are keyed by that turn's message.

Mutants for the shape itself, all red on the named test: capture after sendTurn (unit order test);
drop the running-turn skip (follow-up test); completion never consults the pending ref (drift test);
revert deletes turn refs instead of start refs (revert test); query reads the turn ref (query test).

One result I owe you straight: "capture after sendTurn" stays GREEN on the integration multi-turn
test. With the test adapter the whole turn, completion included, runs inside sendTurn, so a capture
placed after it lands after the completion already consumed nothing, the fallback to turn/1 diffs
the right files, and the e2e test cannot tell "after" from "before". It DOES tell "before the provider
runs" from "behind the checkpoint reactor's queue" — that mutant (the first version's shape: capture
at runtime turn.started in the reactor, none in the provider reactor) is being run now and goes in
the body with its result either way. The unit order test is what pins "before, not after".

Head 6b2b703b5 (pushed): reactor 42/42, provider reactor 68/68, typecheck 0, lint 0. TTFT scratch test
written; runs when the seven #73 lanes are off the machine.
