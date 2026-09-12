# One identity rule, two sides of a seam

A channel name and a member handle are compared in two places: the comms toolkit,
which takes what an agent typed, and the channel decider, which decides what gets
stored. The rule is one rule. The implementations were two, and every gap between
them cost something.

## Why this page exists

The two sides diverged four times in one evening — on how many leading sigils a
name loses, on whether a handle is case-folded, on Unicode normalisation form,
and on where that normalisation sits relative to the fold. **Every time, both
sides' tests were green.** Each side's fixtures already satisfied that side's
rule, so neither suite could see the disagreement.

The fourth divergence is the one that decided the shape of the fix: it did not
come from anyone disagreeing. One side was improved and the other, correct when
it was written, silently became wrong.

A fake of the seam cannot catch this either, and not because anyone wrote a bad
fake: a fake agrees with whatever the toolkit does. The only test that can is one
that imports the decider's real invariants and runs the toolkit's output through
them — [`commsSeam.integration.test.ts`](../../apps/server/src/mcp/toolkits/comms/commsSeam.integration.test.ts),
next to the toolkit's own tests.

The rule now lives in
[`@t3tools/shared/channelIdentity`](../../packages/shared/src/channelIdentity.ts)
and both sides import it.
[`canonicalOneImplementation.test.ts`](../../apps/server/src/mcp/toolkits/comms/canonicalOneImplementation.test.ts)
asserts that by **reference**, not by behaviour: a behavioural comparison passes
the moment two separate functions happen to agree, which was true at most moments
during all four divergences.

## Normalise the key, never the value

The aggregate matches a mention against its membership with an exact comparison.
So:

    match forgivingly — fold case, strip sigils, normalise Unicode, on the LOOKUP KEY
    emit exactly      — what goes out is the bytes the other side stores

Every instance of this bug was the same error: emitting the normalised form. A
member stored `Boss1`, echoed as `boss1`, mentioned as `boss1`, matches nobody
and **the whole post is rejected** — with an error telling the agent to consult
the tool that produced the wrong handle. The same defect sat one axis over in
sigil stripping, where a member stored `@@PM` could not be mentioned by any
spelling an agent would type.

Handles are stored canonical now, so the key and the stored bytes usually
coincide. That is a reason to keep emitting the stored bytes rather than a reason
to stop: the coincidence is exactly what hid the bug.

The one exception, and it is deliberate: an **unresolved** handle goes out in
canonical form, in the error. Nothing compares against it, and showing the agent
the form the lookup actually used is the only diagnostic that error can carry. It
must not say _why_ the lookup missed — "no such channel" and "you are not a
member" are deliberately one answer.

## Canonicalisation runs to a fixpoint

Strip, trim, repeat until nothing more comes off. One pass is not enough: a sigil
can hide behind whitespace a previous strip exposed, so `"# #seniors"` keeps its
second `#` forever. State the **operation** in docstrings, not the property —
"no leading sigil" was a property no single-pass implementation produced.

## Strip decoration, refuse structure

A variation selector or an exotic space is decoration: it changes how a value
renders, not what it is. So it is normalised away, and `boss1` + U+FE0F collides
with the real `boss1` instead of storing beside it. A zero-width joiner is
structure: it changes which grapheme is produced, so stripping it would rewrite
the name — it is refused instead.

Refusing decoration was tried first and rejected legitimate input: U+FE0F is how
emoji presentation is requested, so `❤️` stopped being a storable handle while
plain `🔥` still was.

## NFC is the last step

Lowercasing can produce a newly composable sequence, so normalising first and
folding second leaves output that is not in NFC. `H` + U+0331 folded to `h` +
U+0331 while a roster held the precomposed U+1E96, and the two stored as separate
members rendering identically. Normalising after the fold makes them one identity
and makes the function idempotent — which is what "canonical" has to mean: a
stored value must canonicalise to itself.

## Handles stored before the rule

The rule applies from the change that introduced it. It does not rewrite history,
and nothing migrates the projection.

A member whose stored handle does not canonicalise to itself is **unmentionable
and unremovable**: `channel.post.create` canonicalises the mention and compares it
to the stored bytes, and `channel.member.remove` canonicalises its argument the
same way and then requires an exact member match. The only remedy is to recreate
the channel.

**It is not the row you would look for.** Case folding shipped in the same commit
as the members table, so no channel ever stored `Boss1` — auditing a database for
uppercase handles finds nothing and proves nothing. The rows that can be stuck are
the ones canonical under the rule as it first shipped (trim, strip one run of
sigils, trim, lowercase) and not under its later refinement (strip to a fixpoint,
collapse whitespace runs, strip variation selectors, NFC **after** the fold):
`"@ @pm"` stored as `@pm`, a handle with a no-break space or a doubled space, a
decomposed `café`, `boss1` followed by a variation selector, a CJK name with an
ideographic space.

None exist, and the reason is the load-bearing one rather than the audit: channels
are created only through the decider, and at the time this landed nothing on the
wire could issue `channel.create` — the gateway is still the unwired layer. That
is why there is no migration rather than an oversight. A database that turns out
to hold such a row needs the **projector** to canonicalise on apply, so replaying
old events produces canonical membership; rewriting the rows alone would be undone
by the next rebuild.
