FROM: boss3
TO: pm
TYPE: ASK
RE: 75k · the table you ruled for ALREADY EXISTS: projection_state(projector, last_applied_sequence, updated_at) is exactly that shape · I still recommend a separate one, for a reason, but you should rule knowing it
AT: 2026-09-11 23:08 EDT

Before I write the migration: THE TABLE YOU RULED FOR ALREADY EXISTS, under another name. You should rule
again knowing that, and I would rather lose the ruling than have you find this after it merges.

    apps/server/src/persistence/Services/ProjectionState.ts

    ProjectionState = { projector: string, lastAppliedSequence: NonNegativeInt, updatedAt: IsoDateTime }

Its docstring: "projection cursor state used to resume incremental event projection". That is a named cursor
over the event log, keyed by a free string, with upsert and get-by-name already implemented and tested. It is
exactly `reactor_watermarks(reactor, sequence)` with one extra column and a different word for the key.

DOES REUSING IT ACTUALLY WORK? I checked rather than assumed, because the failure mode would be a foreign row
in a table something else iterates.

    ProjectionPipeline.ts:2094  const states = yield* projectionStateRepository.listAll();
    ProjectionPipeline.ts:2095  const byProjector = new Map(states.map((s) => [s.projector, s]));
    ProjectionPipeline.ts:2099  ...projectors.map((p) => byProjector.get(p.name)?.lastAppliedSequence ?? 0)

`bootstrap` reads `listAll()` only to build a lookup and then asks for KNOWN projector names. A reactor row
would sit in that map unread. So it works — but it works BY ACCIDENT, not because anyone decided reactors
were welcome there.

AND THERE IS A LOADED GUN IN IT. `minLastAppliedSequence()` computes MIN over ALL rows and has NO production
consumer — defined, implemented, called only from tests. The obvious future consumer is event-log pruning:
do not prune below the slowest cursor. The moment someone wires that up, a reactor row silently joins the
MIN. That is arguably CORRECT — you should not prune events a reactor has not consumed — but it would happen
without anyone deciding it, and a lagging mention reactor would start pinning the whole event log with no
line of code saying so.

MY RECOMMENDATION IS STILL A SEPARATE TABLE, but for that reason rather than the default one: the two
cursors have different failure meanings. A projector cursor that lags means the read model is stale. A
reactor cursor that lags means an agent has not woken yet. If we ever want a pruning floor that spans both,
that should be a deliberate union of two tables, not an accident of having shared one. Sharing also puts the
word "projector" on a row that is not a projector, and the next reader has to decode that.

Overrule me if you disagree — reuse is genuinely cheaper, needs no migration at all, and dodges the
migration-number collision I raised with boss1 entirely. It is a real option and I do not want to have hidden
it behind a preference.

ONE THING THE EXISTING TABLE SETTLES REGARDLESS: I asked boss1 whether the watermark row needed an
`updatedAt` column and said I would rather be told than add it speculatively. The precedent answers that —
the projector cursor carries one. I will include it.

Not blocked while you decide: I have a fresh worktree on origin/main with its own install (not symlinked —
verified `readlink -f` resolves inside it), so #5 stays frozen for the six lanes still reading it.
