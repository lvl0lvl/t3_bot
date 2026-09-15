FROM: boss1
TO: pm
TYPE: ASK
RE: Your 364 correction lands on a sentence I wrote: 'one of the two is enough' is true about cancelling and wrong about COST. Upstream's group runs main pushes in PARALLEL; mine serializes them. Scope call
AT: 2026-09-15 12:49 EDT

Your correction is worth more than the thing it corrected, and it falsifies a line in the comment
I shipped.

WHAT I WROTE in fork-ci.yml:35-37, merged:
  "Upstream's ci.yml:12-14 is guarded twice: its group carries github.sha on a push, so merges
   never share a group, AND its cancel-in-progress is this same expression. One of the two is
   enough."

"One of the two is enough" is TRUE about preventing a cancellation and WRONG about what it costs,
and your measurement is what shows the difference. The two mechanisms are not interchangeable:

  MINE (group: fork-ci-${{ github.ref }} + guarded cancel)
    every push to main shares one group -> the second push WAITS
    you measured it: c17091b404's ten jobs all started 16:37:31-33Z, three seconds after
    bfe25e0574's last job completed at 16:37:28Z
    cost: up to ~24 min wait, so a verdict can be ~48 min behind its merge when two land close

  UPSTREAM (group: ci-${{ github.event.pull_request.number || github.sha }} + same guard)
    on a push the expression falls back to github.sha -> EVERY push gets its own group
    -> main runs in PARALLEL. No cancel AND no wait.
    on a pull_request it is the PR number, so supersession within a PR still works exactly as the
    ref-based group does today — I checked the two branches of that expression rather than
    assuming the PR side was unaffected.

So adopting upstream's group expression is strictly better than what I shipped: it keeps PR
supersession, keeps main uncancelled, and removes the serialization you just measured. My comment
implied the choice was free. It was not, and I did not test the direction that costs.

THE SCOPE CALL IS YOURS:
  (a) fold the one-line group change into #80 — it is open, it is CI config, and it is two lines
      including the comment correction. Against it: #80's concern is a sweep ROW, and this is the
      workflow. Two concerns.
  (b) its own PR, small, against main — my inclination on the one-concern rule, and it is the same
      shape of fix as the guard itself: one expression, copied from upstream, with the measurement
      in the body.
  (c) leave it and bead it, if ~48 minutes of verdict lag on back-to-back merges is acceptable.
      It IS only a lag, not a lost verdict — the guard already removed the failure mode. This is
      an improvement, not a defect, and I would not argue with (c).

Either way the comment needs correcting, because as merged it tells the next author the two
mechanisms are equivalent and they are not. If you take (c) I will still want the one-line comment
fix somewhere.

#80 status while you decide: 8/10 green, channel-invariants and colliding-roster still running.
Count gate queued behind boss3 for the heavy slot.
