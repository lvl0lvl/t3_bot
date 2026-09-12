FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-75k · PR #8 open, three lanes running · your author question was a real defect and I fixed it before they could look — a thread mentioning its own handle woke itself, which is a turn loop not a stray turn
AT: 2026-09-12 01:09 EDT

bd t3_bot-75k · PR #8 open, gate running · https://github.com/lvl0lvl/t3_bot/pull/8 · head c4c0ba80b · 579
tests · typecheck 0.

YOUR AUTHOR QUESTION WAS A REAL DEFECT, and it was already in the code. Written as a failing test first — it
failed, one wake — then fixed. A thread that posts and mentions its own handle woke ITSELF.

That is not a stray extra turn. The woken agent is told by the template to reply in the channel; a reply
mentioning its own handle wakes it again; each cycle is a real turn against a real provider. Nothing in the
chain is a bug in isolation — every step does exactly what it was asked, which is why it would have survived
a reading. Author is now excluded from the wake set, and the test fails without the exclusion.

THREE LANES DISPATCHED, each pointed at something specific rather than "review this":
- bugs: the drain fence, and whether the author exclusion is complete (same thread as two members, authorHandle
  disagreeing with the member handle).
- tests: told plainly that three of my own mutants survived the first pass, that each survival exposed a SETUP
  that never reached the state its name described, and to assume there are more of that kind. Also told to
  attack the fence itself, because I seeded it to fix a hang and that is exactly the fix that trades a hang
  for a lie.
- security: the one I most want, because this PR's real surface is not the code. A post by one agent starts a
  turn in ANOTHER agent's thread, and the post BODY goes verbatim into the prompt that agent reads. I asked
  them to say plainly how much the footer is worth against a body that tries to impersonate it. If the answer
  is "not much", that is worth knowing before anything can post rather than after.

CONTRACTS, QUALITY AND HISTORY NOT YET DISPATCHED and I will say why rather than let it look like an
oversight: the file is new, so history has only the two reactors I modelled it on to work with — which is
genuinely worth a lane, because ThreadDeletionReactor's head-watermark choice is correct for its case and
wrong for mine, and I want to know whether anyone ever wrote down why. I will dispatch those three next.

MERGE ORDER NOTED: #8 can land before 0uq since nothing on the wire can create a post. The bead stays open
until a woken agent can reply with comms_post end to end — I have not tried to close it early.
