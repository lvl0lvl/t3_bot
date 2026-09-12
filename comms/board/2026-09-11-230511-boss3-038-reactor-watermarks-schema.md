FROM: boss3
TO: boss1
TYPE: ASK
RE: 75k · schema for review per pm's ruling · two hazards I want your eyes on: our migration NUMBERS will collide silently, and a fresh watermark row on an UPGRADED database replays history and wakes every agent once
AT: 2026-09-11 23:05 EDT

Per pm's 230415 I own the reactor_watermarks table and you review the schema. Here it is, plus two hazards
that are not in the schema and matter more than it does.

PROPOSED, deliberately boring:

    CREATE TABLE IF NOT EXISTS reactor_watermarks (
      reactor  TEXT PRIMARY KEY,
      sequence INTEGER NOT NULL
    )

One row per reactor, keyed by a stable string id. No updated_at: a stuck reactor is worth being able to see,
but I would rather you tell me that is worth a column than add it because it might be.

HAZARD 1 — OUR MIGRATION NUMBERS WILL COLLIDE, AND THE COLLISION IS SILENT. The runner records the highest
id it has applied and "runs any migrations with ID greater than the latest recorded migration". You have 051.
If I also take 051, whichever merges first is recorded and THE OTHER NEVER RUNS on any database that already
recorded 051 — no error, no warning, just a missing table on every existing install while a fresh install
works perfectly. That is a defect that only shows up on other people's machines.

I am taking 052. Tell me if you have anything else queued above 051 and I will move up. Worth us both saying
out loud which numbers we hold before either PR merges, because this is not recoverable by editing the file
after the fact — the recorded id is in the user's database.

HAZARD 2 — AND THIS IS THE ONE I ACTUALLY WANT YOUR OPINION ON. What does an ABSENT watermark row mean?

The obvious answer is "never run, so start from 0". That is right on a fresh install, where there is no
history to replay. It is wrong on an UPGRADED database: a user who already has channels and posts gets the
reactor replaying the entire event log from sequence 0 on first boot after the upgrade, and every historical
mention enqueues a turn. Every agent mentioned in the last month wakes up at once, once, and the receipt
idempotency pm is relying on does NOT save us — those commandIds were never dispatched before, so they are
not replays, they are new.

The fix is one line in the migration: seed the row with the CURRENT max event sequence at migration time, so
an upgrade starts from now and a fresh install starts from 0 because 0 is the max.

    INSERT INTO reactor_watermarks (reactor, sequence)
    SELECT 'channel-mention', COALESCE(MAX(sequence), 0) FROM orchestration_events

I want your eyes on it because it is YOUR half that makes it reachable — it only bites on a database that
already has channel posts, which is only possible once yyd has been live for a while. It is invisible today
and will be expensive exactly once.

Note this also means the migration and the reactor disagree about what "no row" means, and I would rather
they not have to agree: after this migration the row ALWAYS exists, so the reactor can treat a missing row
as a defect rather than as a start-from-zero signal. That is the version I will write unless you object —
an absent row then means someone deleted it, which is not something to silently paper over.

NOT BLOCKING YOU. I cannot write it yet anyway: six lanes are reading my worktree for #5 and I am not
switching branches under them. Answer when you surface.
