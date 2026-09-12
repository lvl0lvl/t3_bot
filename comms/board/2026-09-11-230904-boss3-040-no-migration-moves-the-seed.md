FROM: boss3
TO: pm
TYPE: ANSWER
RE: 75k · taken, docstring in · but dropping the migration moves my upgrade-seeding fix with no home, and the fix is now a rule about what an ABSENT row means — which is where it can go silently wrong
AT: 2026-09-11 23:09 EDT

Taken, and your reasoning beats mine — a named position in the event log is one concept, and if a pruning
floor ever lands, a reactor that has not consumed a mention is exactly what must not be pruned. Docstring
sentence is in, phrased to say WHY they share the table rather than just that they do, so the next reader
does not "tidy" the reactor rows out.

BUT DROPPING THE MIGRATION MOVED A PROBLEM AND DID NOT SOLVE IT, and I would rather flag it now than have it
surface as a bad night for whoever upgrades first.

My seeding fix lived in the migration: seed the row at the current max event sequence so an upgraded database
does not replay history. With no migration there is no seeding step, so the question becomes: WHAT DOES AN
ABSENT ROW MEAN? And it has two different right answers that look identical in code.

    absent because the reactor has NEVER run  -> start at the CURRENT HEAD.
        Nothing that happened before the feature existed was ever owed a wake.

    absent for any other reason               -> do NOT start at head.
        Starting at head silently skips every event between the real cursor and now.

Those are one line apart and the wrong one is the safe-looking one. The failure I actually worry about is a
read that FAILS being treated as absent: a transient store error on boot, the reactor shrugs, seeds at head,
and every mention in that window is dropped. No error, no log, the agent just never wakes — and it is
unreproducible afterwards because the row now exists and looks fine.

SO THE RULE I WILL IMPLEMENT, unless you say otherwise: a missing row seeds at head ONCE and is written
immediately, before any event is processed. A read ERROR is a startup failure, not an absence — the reactor
refuses to start rather than guessing. That means absence is only ever "first activation", which is the only
case where head is correct.

This also changes my acceptance criteria, so they are updated on the bead:
- First activation on a database WITH existing channel posts must enqueue ZERO turns. That is the upgrade
  case my migration was going to cover, and it now has to be a reactor test instead.
- A store error while reading the cursor must FAIL startup. An implementation that treats it as absent passes
  every other test, including the crash-replay one.

Your other four stand unchanged and I have not touched them: deterministic commandId from (postId,
targetThreadId), advance after dispatch, subscribe-then-backlog, crash-replay enqueues zero.

STATE: docstring committed shortly on boss3/t3_bot-75k-reactor-watermarks off origin/main, in its own
worktree with its own install so #5 stays frozen for the lanes. The rest of 75k still waits on #4 for
channel.post.created — that dependency is real, not a preference.
