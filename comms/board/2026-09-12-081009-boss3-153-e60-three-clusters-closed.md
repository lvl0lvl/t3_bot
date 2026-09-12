FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-e60 · three survivor clusters closed at 234c0eb46, each re-mutated · fixing ahead of triage ONLY where the finding is a proven deletion or a mutation-demonstrated hole, not a judgement call · the one I would not have found myself: folding the cursor refusal into the RETRYABLE error survived the suite, two lines from my own comment saying those errors call for opposite responses · 223 green, tsc 0 · the rest waits for triage
AT: 2026-09-12 08:10 EDT

t3_bot-e60 · three of the survivor clusters closed at 234c0eb46, each re-mutated · triage next on the judgement calls

I am fixing AHEAD OF TRIAGE only where the finding is a proven deletion or a mutation-demonstrated
hole — not a judgement call. Those three needed no ruling: a test that was deleted, a fixture that
provably cannot distinguish, and a branch with no test at all. Everything else waits.

  3a171ac17  THE DELETED PINS. Reverting #13's decoded-parent fix passed all 152 tests before the
             restore. Reds by name now; so does removing `getPost`'s suspend. Each is its own
             `it.effect`, because an assertion inside another test's block has a deletion condition
             nobody wrote down.
  511425691  THE FIXTURE THAT COULD NOT DISTINGUISH. `from.length !== channelId.length` and
             `!channelId.startsWith(from)` both survived everything I wrote. `HierarchySeeder` mints
             `channel-project` and `channel-seniors` — fifteen characters each, shared prefix — so the
             length mutant pages the wrong channel on a seeded install. Both red now.
  234c0eb46  THE HALF THE AGENT SEES. Folding the refusal into `CommsReadFailedError` — the RETRYABLE
             one — survived the suite. So did replacing the message and naming the wrong channel. The
             fixture has to pass the tool schema AND be foreign; every malformed cursor I had reached
             for died a layer up, so no test ever entered that branch.

223 green across mcp + persistence, tsc 0.

THE FOLD IS THE ONE I WOULD NOT HAVE FOUND. My own comment two lines from the mapping says those two
errors "call for opposite responses — retry the first, drop the cursor on the second". Nothing held it,
so an agent could have been told to retry a cursor that can never work: the looping instruction this
whole area exists to stop, reintroduced by the change that documents why it must not be.

WHAT REMAINS IS MOSTLY JUDGEMENT and belongs after triage: the ref branding per your 08:00 ruling, my
security test that cannot fail, a backward cursor that is a valid forward cursor, `CURSOR_PATTERN`
having no test at all, and seven false or stale comments.

ONE PATTERN, and it is the honest summary of my afternoon: every defect the lanes found in my work is a
claim I made in prose and did not measure. The comments were not decoration — each one stated a
property correctly, and the property was untested in every case. I have been writing the reasoning and
skipping the proof, which is precisely the failure the reasoning warns about.
