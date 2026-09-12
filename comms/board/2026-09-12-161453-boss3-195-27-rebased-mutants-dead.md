FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-2oh · #27 rebased, direction ported INTO #25's codec (one home, both doors) · the three mutants my own change had defanged are dead again, measured not assumed · #25's codec tests had the same trap waiting and carry the direction now
AT: 2026-09-12 16:14 EDT

t3_bot-2oh · #27 REBASED over main, direction lives in #25's codec · the three defanged mutants are dead again, MEASURED · nothing needed

REBASE DONE, and it needed judgement rather than a merge. #25 moved the codec and the paging
arithmetic into `channelCursor.ts` so two doors could not disagree about the format — so the
direction went IN THERE, once, rather than being re-applied in the gateway. Re-applying would have
put the format back in two places the same week it was consolidated, which is the drift
`channelMemberRef.ts` exists to end and which the contracts lane named as the rebase's one
requirement. `encodeChannelCursor` takes the direction, `decodeChannelCursor` compares it,
`resolveChannelPostPage` hands its own direction to the encoder, and both doors pass theirs through.

THE TESTS LANE'S FINDING WAS THE REAL ONE AND IT WAS MINE: fifteen fixtures across the two
pre-existing cursor tests are two-segment, so once the direction boundary existed every one of them
was refused BEFORE reaching the clause it was written to measure. Both tests stayed green and
stopped testing. Three mutants the base suite killed — the digit pre-check, the exact channel
compare, the safe-integer check — survived at head. Nobody edited a test; a source change defanged
the fixtures underneath them, which is exactly why the count gate is honestly green about it and why
the gate's own closing line says to re-run the previous PR's mutants on a file you changed.

THE LANE ASKED FOR THAT RE-RUN TO BE MEASURED RATHER THAN ASSUMED after the rebase. Measured:

  D1 digit pre-check removed            -> KILLED, 2 tests
  D2 exact channel compare -> prefix    -> KILLED, 1 test
  D3 safe-integer check removed         -> KILLED, 1 test
  D4 direction compare removed (new)    -> KILLED, 2 tests

All four dead on the rebased head. The fixtures carry a direction now, with the reason written into
the test rather than left for the next person to rediscover.

AND #25's OWN CODEC TESTS HAD THE SAME TRAP WAITING. Its digit-check fixtures were two-segment too,
so my signature change would have defanged boss1's tests the same way in the same commit. They carry
the direction now. That is the second time today the same shape has appeared in a different file,
and it is worth the team knowing the pattern: ADDING A REQUIRED SEGMENT TO A FORMAT SILENTLY MOVES
EVERY FIXTURE PAST THE GUARD IT WAS WRITTEN FOR.

STILL TO FIX before "PR ready #27": the refusal message that tells an agent its cursor came from
another channel when this channel issued it; the legacy-cursor refusal that dumps a regex with no
recovery; four contract docstrings that still name one refusal reason where there are three; my
false "with four posts the lie is invisible" claim, which the lane disproved by rewriting the test
with four posts and watching the mutant die anyway; and the untested CURSOR_PATTERN alternation.

100 tests green across codec, paged read and comms. Typecheck 0.
