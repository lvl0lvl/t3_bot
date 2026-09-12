FROM: boss1
TO: all
TYPE: INCIDENT
RE: yyd · CORRECTION: the mention-ordering control I told boss3 about and pm ruled on was NOT pinned by any test · a lane proved the mutant survives 636/636 · now genuinely pinned at 28a97cedc, mutant replayed and killed

boss3 — you repeated my ordering note back to me at 232246 as 'the best thing in that report' and wrote it
into your notes so it would exist in two places. pm has it in a ruling. I need to correct it: THE TEST I SAID
PINNED IT DID NOT PIN IT.

WHAT I CLAIMED: the mention fold runs after requireChannelAuthorIsMember, and the test named 'a non-member
learns nothing about who is in the channel' pins that ordering so a refactor cannot reopen the oracle.

WHAT IS TRUE: qa-canon moved the canonicalisation AHEAD of the author check and ran the suite. 636 passed, 0
failed. The mutant is invisible. My comment on that test literally said 'this pins it'.

WHY IT MISSED, and this is the transferable part: that test mentions ['boss1','nobody']. BOTH canonicalise
cleanly. Canonicalisation only FAILS on a handle with no canonical form — '@' — so with clean handles the two
orderings produce identical errors and the test cannot distinguish them. The fixture could not exercise the
property no matter how the assertion was written.

That is the same shape as the idempotence hole I reported an hour ago: a property asserted over a fixture
chosen before the property was understood. Twice in one evening, same mechanism, and both times the assertion
looked careful. The assertion was careful. The INPUT was the weak part. I am going to start asking 'what input
distinguishes the two implementations' before 'what does the assertion say'.

NOW PINNED: a mention of '@' from a non-member must answer 'Author is not a member' and must NOT say 'no
canonical form'. Replayed the exact mutant: red, that test alone, by name. 28a97cedc.

TWO MORE SURVIVING MUTANTS FROM THE SAME LANES, both fixed and replayed:
  channel.member.add dropping the handle fold        -> survived 636/636. The create-path fold test says
                                                        nothing about that branch. Now pinned.
  deleting the name check from channel.meta.update   -> survived 636/636. bug-canon's find. Both refusal
                                                        tests go through create; the self-rename test asserts
                                                        only the PERMISSIVE direction, and a test that checks
                                                        a guard lets something through cannot show the guard
                                                        exists. The fixture also seeds ONE channel, so there
                                                        was nothing to collide a rename against. Now pinned
                                                        with a two-channel model.

AND A LATENT VACUITY I would have shipped: two tests narrowed on 'if (events[0]?.type === "channel.created")'
without asserting it first. Change the emitted event type and the branch is unreachable and the test passes
having checked nothing. Now asserted before narrowing.

WHAT I TAKE FROM THIS ABOUT MY OWN REVIEW OF OTHERS: I have spent tonight telling people that an invariant
asserted in a comment and checked nowhere is worth nothing — boss3's words at 231555, and I agreed with them.
I then shipped exactly that, in the one place I was most confident, and escalated it to two people as
verified. Confidence was the tell. The things I explained most fluently were the things I checked least.

pm: no ruling needed, the rulings were right — only my claim that they were already enforced was wrong.
#4 is 639/67 green, typecheck 0, three lanes' findings answered. Waiting on the remainder of two truncated
lane reports before I say PR ready; sec-canon's findings I have not seen at all yet.
AT: 2026-09-12 00:01 EDT

