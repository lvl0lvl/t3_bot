FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-h2u6 · all three commands measured by reading, none can produce the pair · AND a wrong citation found at decider.ts:2310 — it points at collidingRoster.ts for a state collidingRoster does not hold, which is exactly the state duplicateRef.ts will hold · proposing to fix it as part of your both-ways cross-reference
AT: 2026-09-15 17:34 EDT

bd id · state · what changed · what you need

  t3_bot-h2u6 · not started, per your "#82 first" · the pre-write measurement you required is
  DONE (reading, not execution — saying so explicitly) · need a yes/no on one extra line of
  scope in decider.ts. No rush; #82 still first.

THE THREE COMMANDS. None can produce one ref under two handles. Each by READING, none by
execution; the reading is conclusive in all three and I will say in the body that it was
reading.

  channel.create        decider.ts:2070   requireChannelMembersUnique({ seated: [], adding:
                                          members }) — `adding` is compared against ITSELF,
                                          so two members sharing (kind,id) under two handles
                                          are refused by the REF clause. CANNOT.

  channel.member.add    decider.ts:2194   ({ seated: channel.members, adding: [member] }) —
                                          the added row is compared against every seated row,
                                          so a second handle for a seated ref is refused by
                                          the REF clause. CANNOT.

  channel.member.rename decider.ts:2316   ({ seated: members.filter(m => m.handle !== from),
                                          adding: [{ ...renamed, handle: to }] }) — the
                                          renamed row is lifted out of `seated`, so on a
                                          roster with no existing duplicate its ref matches
                                          nothing and only the HANDLE clause can fire.
                                          CANNOT — and for a reason stronger than the
                                          invariant: a rename changes a handle on a row that
                                          already exists. It never ADDS a row, so it cannot
                                          raise the count of rows holding one ref from one to
                                          two whatever the invariant does.

  refKey is JSON.stringify([memberKind, memberId]) (commandInvariants.ts:415-417), which is
  what makes "the REF clause" mean the pair and not the id.

THE CITATION IS WRONG, and it is wrong about precisely this state. decider.ts:~2308-2313, in
the rename case:

  "On a roster replayed from before `t3_bot-1ez` (one ref under two handles,
   `testing/collidingRoster.ts`) the REF clause fires too: the other row still holds the ref,
   so renaming EITHER handle is refused naming the other."

The STATE it describes is right and is h2u6's. The MODULE it cites does not hold that state.
collidingRoster seats human X beside thread X — two different KINDS, therefore two different
refKeys, therefore the REF clause CANNOT fire on a rename over that roster. The sentence
describes correct behaviour over a roster the cited fixture does not produce, so the claim as
written is unverifiable against the thing it points at.

I read all 326 lines of collidingRoster.ts before saying this; it models one collision and
that is the kind collision. This is the "a cited answer carries its date AND ITS SUBJECT"
failure, in a source comment, pointing forward at a module that does not exist yet.

WHAT I PROPOSE, and it is one line: when duplicateRef.ts lands, repoint that parenthetical at
it. Your ruling already says "a cross-reference in both directions that says which collision
is which and that a test wanting the kind clause wants the other module" — this is a third
site that needs the same sentence, and it is the site where getting it wrong already happened
once. Fixing it in the h2u6 PR keeps the wrong citation from outliving the reason it was
wrong.

  Why I am asking rather than just doing it: it is a production file under
  apps/server/src/orchestration, which the board protocol says to CLAIM before touching, and
  it widens an h2u6 PR by one file. Say no and I will file it as its own bead instead; I would
  rather it be a bead than a silent addition to a fixture PR.

I have NOT touched anything for h2u6. No module, no test, no config row.
