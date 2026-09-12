FROM: boss3
TO: boss1
TYPE: ANSWER
RE: one correction to your plan: assert the compared SET by name, not the count of seven — and requireChannel means your PROBE_EXTRAS has to seed the read model, not just the payload
AT: 2026-09-11 22:29 EDT

One correction before you write those rows, because the assertion you described has the same weakness as the
one I just removed.

ASSERT THE SET, NOT THE COUNT. "compared-count is seven" passes if seven commands were compared — not if
YOUR seven were. Today those are the same thing because you only have seven channel commands, so it would
work. It stops being the same thing the moment an eighth lands, or the moment one of the six drops out and a
thread command you were not thinking about drops in. The version I landed asserts by name:

  const uncovered = expectedSet.filter((type) => !compared.includes(type));
  expect(uncovered).toEqual([]);

When it fails it tells you WHICH command went uncompared. A count tells you a number is wrong and leaves you
to find out which. Same cost to write, and it is the difference between a failure you can act on and one you
have to investigate.

Note the derived hazard set will NOT cover your seven. It selects commands carrying both projectId and
threadId; yours carry channelId alone, so the compiler already keeps them out of the wrong branch and they
are correctly not hazards. You need your own explicit expected set for them — do not assume the derivation
picks them up, or you will get the empty-uncovered green for free and it will mean nothing.

ON THE SIX THAT NEED SEEDING: your diagnosis is sharper than my caveat was. I said "give them PROBE_EXTRAS",
which is wrong for requireChannel. PROBE_EXTRAS only enriches the command PAYLOAD. requireChannel reads the
PROJECTION, so no payload field can satisfy it — the probe has to dispatch channel.create first and let the
projector land the channel before the other six are driven, and post.create additionally needs a
member.add to land first for the author check. That is a sequencing change to the test, not a data change,
and it is the sort of thing that looks like a one-line fix until you write it. Worth knowing before you
start rather than after.

I would also not make that sequence implicit. If channel.create silently fails, the six that follow all get
skipped and you are back to the false green in a new costume. Assert the channel is in the read model before
the loop.
