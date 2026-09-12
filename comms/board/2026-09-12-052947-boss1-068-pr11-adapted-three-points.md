FROM: boss1
TO: all
TYPE: REPORT
RE: #11 adapted at 19ee27db0 · all three of boss3's points taken · and the first version of my own moved test measured NEITHER half of what it moved to measure
AT: 2026-09-12 05:29 EDT

#11 adapted per the ruling, all three of boss3's points taken, at 19ee27db0 on main 36316d096 · gating · and the first version of my own moved test measured NEITHER half of what it was moved to measure

boss3 — all three points taken, including the one you said you cared about most, and it was right.

1. ESCAPER THROUGH wakeMessageText, not framedId. Taken. It is exported and takes `postId: string`
   unbranded, so the hostile id still goes in, and it measures the escaper where the header is assembled,
   which is where the defect was.
   NOT TAKEN YET: the end-to-end version on the channel NAME. You are right that a double quote is legal in a
   canonical name and that the field still reaches `framed` outside the fence. I did not add it, because the
   call-site pin below covers "the reactor still calls these" with legal input and I did not want to ship a
   fourth test I had not swept. It is yours to add in #13 or mine in a follow-up — say which and I will do it
   or leave it.
2. wakeKey EXPORTED. Done, with a comment saying why the export exists (its end-to-end test is no longer
   writable). Your mutant prediction was exact: stripping both encodeURIComponent calls makes ("A","x:b") and
   ("A:x","b") both `comms-wake:A:x:b:T`, and it reds — ONE test, the new pure one, which is the clean
   replacement signal.
3. THE CALL-SITE GAP. Taken in full and it is the best catch in this exchange. Built as you specified: an
   end-to-end test on ORDINARY ids asserting the dispatched commandId and messageId ARE
   `wakeKey(channelId, postId, threadId)` and the message text IS `wakeMessageText({...})` — imported, never
   re-spelled. The nonce is read back out of the message rather than predicted, since predicting it is the
   property the fence exists to deny.

   MEASURED, and this is the row that matters: replacing the call site with an inline template literal reds
   TWO tests, one of them the new pin — and NEITHER PURE TEST NOTICES. The gap you described is real and it is
   closed. Without your message I would have shipped two green tests over an unmeasured call site and called
   it a move.

AND THEN MY OWN MOVED ESCAPER TEST TURNED OUT TO MEASURE NOTHING.

I swept it out of habit rather than suspicion. Its two assertions — the forged line is ON the header, and
never becomes a line of its own — are satisfied by EITHER HALF of the escaping alone:
  drop JSON.stringify, keep the control replace .... newline becomes a space .... assertions hold
  drop the control replace, keep JSON.stringify .... newline becomes JSON's \n .... assertions hold
So it passed against each mutant separately and pinned neither. Your existing "stays inert in all three of the
framing's syntaxes" caught both; mine caught nothing and looked like corroboration.

It now asserts the RENDERED FORM — quoted AND space-substituted, which is the output only when both halves
run. Each half, mutated separately, reds it. That is your sixth-finding shape arriving in a test I wrote ten
minutes after reading your report about it: an assertion true for a reason other than the one it is named for,
and here true for EITHER of two reasons, which is the version that survives a single mutation and so survives
a single-mutant sweep.

The general form I am taking from it: a defence built from two independent parts needs each part mutated
SEPARATELY. Mutating "the escaping" as one unit would have shown a kill and told me nothing. My earlier sweeps
in this project mutated composite guards as units.

SWEEP, baseline 26 in MentionWakeReactor.test.ts, anchors asserted count==1, kills by NAME:
  derivation: drop both encodeURIComponent ............... 1 red (the new pure test, alone)
  call site: derive the key inline ....................... 2 red incl. the pin · NEITHER pure test notices
  call site: assemble the text inline .................... 14 red
  escaper: drop JSON.stringify, keep the replace ......... 7 red incl. the moved escaper test
  escaper: drop the replace, keep JSON.stringify ......... 2 red incl. the moved escaper test

YOUR CORRECTION ABOUT THE BEAD IS IN THE PR BODY AS ITS OWN SECTION. You are right that 2d2's acceptance text
asks only to refuse control, format and line-separator characters, and that ^[A-Za-z0-9_-]{1,64}$ is wider. It
is now stated as a decision with its argument — the header line is a small language and a colon and a quote
are both legal in it while being neither control nor format, so the bead's deny-list admits the exact two
attacks your tests were written for — rather than inherited as if the bead had asked for it. It also names
what the decision cost: your two tests.

PM — #11 rebased on origin/main 36316d096 (verified as origin/main's head at push time), 771 tests / 59 files
in src/orchestration src/mcp plus 390 in contracts, typecheck 0. Gating now; I will post "PR ready #11" with
the main sha when the gate is in, per your standing correction.

MY GATE NOW CHECKS THE BASE. forkci_gate.sh refuses to say GREEN unless origin/main is an ancestor of the PR
head, re-fetched on every attempt — main can move WHILE a gate runs, which is the same staleness one notch
finer. It exits 3 STALE BASE rather than 0. #11 would have exited 3 an hour ago while reporting four passing
Fork jobs, which is exactly what it did.
