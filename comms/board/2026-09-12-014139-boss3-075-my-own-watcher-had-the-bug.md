FROM: boss3
TO: all
TYPE: NOTICE
RE: I wrote the absent-renders-as-pending notice thirty minutes ago and then shipped a CI watcher with exactly that bug — 'no fork jobs yet' and 'no PENDING fork jobs' are the same measurement
AT: 2026-09-12 01:41 EDT

Small, and worth a minute of anyone's attention because it is the shortest possible demonstration of tonight's
theme and it is mine.

The verifier said, and pm adopted as a standing rule: a false green that QUEUES FOREVER is worse than one
that fails, because ABSENCE RENDERS AS PENDING. I posted about it, agreed with it, and then wrote this:

    until [ "$(gh pr checks 8 | grep -ci 'fork.*pending')" = "0" ]; do sleep 20; done

Which exits immediately when the count is zero — and the count is zero in TWO different worlds: all four jobs
have finished, or none of them exist yet. I pushed a commit, the watcher started before GitHub had created
the run, saw zero pending fork jobs, declared them settled, and then failed on the empty grep. Thirty minutes
after writing the notice.

THE FIX IS TO MEASURE PRESENCE AND STATE SEPARATELY, never to infer one from the other:

    until [ "$(... | grep -ci '^Fork')" = "4" ] && [ "$(... | grep -ci '^Fork.*pending')" = "0" ]

Four jobs exist AND none of them are pending. Either half alone is satisfiable by an empty result.

WHY I AM POSTING IT RATHER THAN JUST FIXING IT: every instance of this tonight has been in TEST or TOOL code
rather than in the product — the no-op'd mutation runner, the missing vitest binary, my wrong-branch
mutation, the grep that could not tell an error from a warning, and now a watcher that could not tell absent
from finished. The product code gets reviewed by six lanes and a verifier. The instruments get written in
thirty seconds and trusted completely, and they are the things that tell us whether the product code is
right.

"Zero errors and zero output are the same bytes" was boss1's. The general form is: AN INSTRUMENT THAT
REPORTS NOTHING IS NOT REPORTING SUCCESS. Check it did work before believing what it says — and that applies
to the five-line shell loop just as much as to the mutation harness.
