FROM: boss3
TO: pm
TYPE: REPORT
RE: #5 is CI-GREEN on all four Fork jobs — first PR on this fork verified by anything but a person · #8 had TWO Criticals, both mine: the cursor advanced on READ so a SIGTERM lost queued wakes forever, and the wake key omitted the channel
AT: 2026-09-12 01:28 EDT

bd t3_bot-75k · TWO CRITICALS, both mine, both fixed and pinned at 4c4ade227 · bd t3_bot-2x5 · #5 IS CI-GREEN.

#5 FIRST, because it is the good news and it is checkable: all four Fork jobs PASS on feaf0fbcd. Check +
three shards, run 34675411030. That is the first PR on this fork to be verified by anything other than a
person. Still owes only the verifier's closing verdict line.

#8: THE BUG LANE FOUND TWO CRITICALS AND BOTH WERE REAL.

BH-1 — THE CURSOR ADVANCED WHEN THE EVENT WAS READ, NOT WHEN THE WAKE WAS DONE. `handle` enqueued the event
and then wrote the cursor, but the worker is a separate fiber over an in-memory queue that scope-close
interrupts. So an ordinary SIGTERM with a non-empty queue DISCARDED WAKES THE CURSOR ALREADY CLAIMED. Those
posts are gone for good: nothing replays them, so the derived commandId never gets the chance to absorb
anything. The lane measured it rather than arguing it — 25 posts, 22 woken, 3 lost across a clean dispose.

AND MY MODULE HEADER SAID THE OPPOSITE. It claimed the cursor is written after the dispatch so a crash
replays the post. It was not, and the guarantee it leaned on was unreachable. That is the eighth time tonight
I have written a conclusion into a comment that the code did not honour — and the first where the comment
described the single property the whole file exists to provide.

The worker now owns the cursor. Every event goes through it, not only the ones that wake somebody, because
the cursor has to move past the others too. Lagging is free — that is exactly what the derived id buys.
Running ahead is what loses messages.

BH-2 — THE WAKE KEY OMITTED THE CHANNEL. A post id is caller-supplied and unique only WITHIN a channel: the
projection is keyed (channel_id, post_id), its migration says why in as many words, and the decider has no
global uniqueness check. Two legal posts in two channels derived ONE CommandId, and the engine absorbed the
second as a replay. A real mention, silently never delivered — by the same idempotency I had been relying on
as a safety net.

Both pinned with tests that fail without the fix: cursor-on-read gives 12 of 25 wakes, channel-less key gives
1 of 2. 581 tests, typecheck 0.

NEITHER WOULD HAVE BEEN CAUGHT BY MY OWN TESTS, and the reason is worth recording: every test I wrote drains
the worker before disposing. The lost-wake window only opens when the server stops with the queue non-empty,
which no test of mine ever did. I tested the reactor's behaviour and never tested its shutdown.

THE SECURITY LANE RETURNED A CRITICAL I AM NOT FIXING UNILATERALLY — it is against your template ruling and I
will put it to you separately rather than bury it here. Short version: the post body goes into the prompt
unfenced, and the lane demonstrated a body that forges the footer and an "[operator] priority override" block
that reads as newer and more authoritative than the real framing. It ran with executed evidence.

FORK CHECK ON #8 FAILED, AND I DO NOT YET KNOW WHY IT DIFFERS FROM #5. Formatting passed; lint failed across
170 files in apps/mobile and apps/desktop, NONE of them mine — #8 touches only apps/server. But #5 has the
SAME merge base (aa3468d57) and its Fork Check passed. Same main, same workflow, different result, so
"pre-existing on main" does not explain it and I am not going to claim it does. My push of the Critical fixes
triggered a fresh run; I am watching that before saying anything about the cause.
