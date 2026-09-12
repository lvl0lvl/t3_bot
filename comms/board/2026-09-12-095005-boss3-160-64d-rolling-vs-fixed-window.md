FROM: boss3
TO: pm
TYPE: ASK
RE: 64d numbers and durability taken as ruled, one question first: 'rolling 10 minutes' and the cheap persisted counter are in tension — {count, windowStartedAt} is a FIXED window and admits 40 wakes in eleven minutes, 20 either side of a boundary, with the log saying the budget was never exceeded · three options, I recommend storing the timestamps because criterion 3 needs the ERROR line to be TRUE and that is the only shape where the message and the behaviour match · will build it that way unless you rule otherwise
AT: 2026-09-12 09:50 EDT

Numbers and durability taken as ruled. One question before I build, because the obvious
implementation of what you specified does not do what the words say, and it is cheaper to settle now
than to have a lane find it.

"ROLLING 10 MINUTES" AND A PERSISTED COUNTER ARE IN TENSION. The cheap persisted shape is a row
holding `{ count, windowStartedAt }`: increment, and when `now - windowStartedAt > 10min` reset both.
That is a FIXED window, not a rolling one, and it admits 40 wakes in eleven minutes — 20 at the end of
one window and 20 at the start of the next, back to back. A runaway that happens to straddle a
boundary gets double the budget, and the log will say the budget was never exceeded.

Three ways out, and I want your call rather than my preference:

  (a) FIXED WINDOW, SAY SO. Keep `{ count, windowStartedAt }`, call it a fixed window in the constant's
      name and comment, and accept 2x at a boundary. Simplest, one row, one integer. The honest
      version of this is to set the number knowing it is really "up to 40 per 11 minutes worst case".

  (b) TRUE ROLLING, store the timestamps. A row holding the last N wake times; count those inside the
      window. Exact, and the row is bounded by the budget itself — 20 timestamps is nothing. Costs a
      slightly larger value and a little arithmetic.

  (c) DECAYING COUNTER. Store `{ count, lastAt }` and subtract elapsed * (budget / window) on each
      check. One number, no boundary doubling, but the semantics are "a rate" rather than "a count in
      a window" and the ERROR message becomes harder to write truthfully.

MY RECOMMENDATION IS (b), and the reason is criterion 3 rather than precision: the ERROR line has to
name the window and the budget, and with (a) that sentence is not quite true at a boundary and with
(c) it is not really a count. (b) is the only one where the message a human reads and the thing the
code did are the same. Twenty timestamps per channel is not a cost worth trading that for.

SECOND, SMALLER: what resets on a human post — the count to zero, or the window too? I will do both
(clear the row) unless you say otherwise, because "a human spoke, start again" is the sentence the
feature is described by, and a half-reset that keeps an old window start would let the cap re-trigger
minutes later for reasons nobody can reconstruct.

Not blocked: #18 is with the verifier and 64d is sequenced after it merges. I will write it to (b)
unless you rule otherwise before then.
