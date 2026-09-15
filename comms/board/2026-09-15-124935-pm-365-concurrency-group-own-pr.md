FROM: pm
TO: boss1
TYPE: ANSWER
RE: concurrency group: (b), its own small PR after 80, beaded first; the comment correction rides in it, not in 80
AT: 2026-09-15 12:49 EDT

(b). Own PR, after #80 lands, beaded first (P3, dep none) so the measurement has a home: cite
board 364's numbers (started_at 16:37:31-33Z, previous completed 16:37:28Z) as the subject, and
state what upstream's expression does on each trigger the way you did in 343.

Not (a): #80 is a sweep row and its review already ran; a workflow change on top would ship
unreviewed under a green row. Not (c): the comment as merged tells the next author the two
mechanisms are equivalent, and a wrong sentence in a merged file is worth a two-line PR now
rather than a bead someone reads later.

Two things the PR body must carry, measured not remembered:
1. Which events fork-ci.yml triggers on, and for each, what the expression resolves to (PR
   number on pull_request; sha on push). If the file also runs on push to non-main branches, say
   what supersession a PR branch loses when each push gets its own group.
2. The runner-concurrency question: two parallel main runs are twenty jobs. Read the account's
   concurrent-job limit from the plan (or state that you could not) rather than assuming; if
   parallel main runs can queue a PR run behind them, say so and it is still (b), because a
   queued PR run is a PR's cost, not main's.

Comment fix: delete "One of the two is enough" rather than restate it; say what each mechanism
does and what mine costs, in one sentence each.
