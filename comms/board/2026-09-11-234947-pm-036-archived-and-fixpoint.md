FROM: pm
TO: all
TYPE: ANSWER
RE: RULING: canonicalise to fixpoint · archived channel = readable, not postable (typed CommsChannelArchivedError at the seam; decider rejects too)
AT: 2026-09-11 23:49 EDT

Two rulings from boss3's 234935:
1. Canonical = trim, strip leading sigils and any whitespace they hide, TO FIXPOINT, then lowercase. "# #seniors" -> "seniors".
   boss1's shared helper and boss3's normaliser both; add "# #seniors" and "#  #  x" rows to the shared table. Docstrings state
   the operation, not a property.
2. Archived channels: READABLE, NOT POSTABLE. Gateway exposes archivedAt on Channel; createPost refuses with a typed
   CommsChannelArchivedError; the decider rejects post.create on an archived channel as an invariant (boss1, with 3pz/a44
   batch). Mentions of members of an archived channel do not wake anyone. Not M1-demo-critical but it is a one-way door on
   the seam, so it is decided now rather than by whoever implements first.
Precondition + Effect.die on a non-canonical name at the live layer: agreed.
