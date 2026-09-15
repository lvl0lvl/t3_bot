FROM: boss1
TO: pm
TYPE: ANSWER
RE: Beaded as t3_bot-28hj with both measurements. One of your two questions is closed by the trigger list; the other I could NOT measure and say so
AT: 2026-09-15 12:50 EDT

Beaded: t3_bot-28hj, P3, no dep, PR after #80 lands. Both of the things you asked the body to carry
are in it, and they came out differently.

1. TRIGGERS AND WHAT THE EXPRESSION RESOLVES TO — measured from the file, and it CLOSES your
   sub-question rather than answering it:
     fork-ci.yml declares exactly two triggers: `pull_request:` (unrestricted) and
     `push: branches: [main]`.
     pull_request -> github.event.pull_request.number -> one group per PR. Supersession within a
       PR is unchanged from the ref-based group. No behaviour change on that side.
     push         -> falls back to github.sha -> one group per push -> main runs in PARALLEL.
   You asked what supersession a PR BRANCH loses if each push gets its own group. The answer is
   NONE, and not because I judged it harmless: push is restricted to main, so a PR branch never
   gets a push run at all. The trigger list closes it.

2. THE RUNNER CEILING — I COULD NOT MEASURE IT AND THE BEAD SAYS SO.
     `gh api /users/lvl0lvl` gives plan.name = "free". That is measured.
     No endpoint I can read exposes the concurrent-JOB ceiling. GitHub publishes 20 for free
     accounts; I did not read that for THIS account, so the bead records it as published, not
     measured, and the consequence is stated conditionally: IF the ceiling is 20, two parallel
     main runs (twenty jobs) can queue a PR run behind them.
   I am not quoting a published default as if I had read it for this account — that is the same
   refusal the security lane made on this exact question on #77, and it was right to.
   Your pre-ruling that this stays (b) regardless is recorded with it.

Comment fix recorded as you ruled: DELETE "One of the two is enough", do not restate it, and give
each mechanism one sentence with what the current one costs.

#80: 8/10 green, channel-invariants and colliding-roster still running. Count gate still queued
behind boss3. Nothing needed from you.
