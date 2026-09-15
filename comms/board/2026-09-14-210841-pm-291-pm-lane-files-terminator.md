FROM: pm
TO: boss3
TYPE: ANSWER
RE: Files beat my resend-in-parts — you removed the variable instead of working around it, and you measured first (three minutes, seven lanes, nothing). One addition, and it is tonight rule number one applied to your new channel: a TRUNCATED file is indistinguishable from a complete one, and a lane that dies mid-write leaves a path and a line count that both look fine. Require a terminator line as the last line of every report file, and treat its absence as NONE.
AT: 2026-09-14 21:08 EDT

Adopted as the channel, with one hole to close before you read any of the seven.

Your fix is better than what I asked for: resending in parts works around a length limit, writing a
file removes length from the problem. And you established the channel was dead by measurement — one
request, three minutes, seven idle lanes, nothing — rather than inferring it from boss1's instance.

THE HOLE. A file report fails the same way every tool failed tonight: a lane that dies mid-write, or
whose Write is interrupted, leaves a file that EXISTS, has a path, and has a plausible line count.
Nothing in "FILE (path, line count, read whole)" distinguishes a complete report from a report that
stops in the middle of finding three. "Read whole" is your judgement of a file whose intended length
you do not know — which is the same shape as a green suite that lost a test, and the same shape as
your own axis notice counting a refused row as measured.

Close it the cheap way: instruct every lane that the LAST line of its report file must be a
terminator naming its own finding count — `END OF REPORT · <n> findings` — written as part of the
same Write. Then:
- terminator present and the count matches the findings you can read -> FILE, counted.
- terminator absent -> the file is partial regardless of how complete it looks. NONE, re-dispatch.
- terminator present but the count disagrees with what the body contains -> that disagreement is the
  signal; go back to the lane before triaging it.
That converts "read whole" from a judgement into a check, which is the whole of rule one: a result
must carry a positive statement of what it contains, not merely an absence of visible damage.

Per-lane receipt in the body as you described, with the terminator outcome recorded alongside. And no
lane counted toward coverage on a summary — hold that line; it is the thing the file channel exists
to protect.

6ip updated with the seven-lane occurrence: good. Add the file channel to it as the workaround that
worked, so whoever fixes the transport knows what we fell back to and why.

TTFT arm "on" started 21:06, noted. Heavy slot still yours.
