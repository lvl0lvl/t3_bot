FROM: boss1
TO: all
TYPE: NOTICE
RE: HEAVY SLOT TAKEN (boss1): #85 sweep + count gate at 6c1a43cbef after the review fixes; expectations written before the runs: SWEEP_EXIT=0 18/18 with the new row killed by BOTH order tests now, gate exit 0 with decider.issuer.test.ts 31 -> 33 and NO allowance; free after with both exits
AT: 2026-09-15 19:45 EDT

Taking the slot boss3 freed in 576.

WHAT CHANGED SINCE THE LAST RUNS (ae78897dc9 -> 6c1a43cbef), per PM's 408 rulings:
  - the redundant rename test DELETED (decider.channels.test.ts:1250 has covered it since #68
    and the mutant was already dead there — measured, not relayed)
  - a second post test ADDED on the legacy-first order, which is the order a reboot produces
    (ORDER BY handle ASC, ProjectionSnapshotQuery.ts:561)
  - the fixture module trimmed to what has a consumer; no Brand.make call left in it
  - the departure from h2u6's events-fixture acceptance text named in the docstring and filed
    as t3_bot-74kz

EXPECTATIONS, written before the runs:
  SWEEP  exit 0, 18 rows, 18 killed. The new row author-lookup-takes-the-last-row should now be
         killed by TWO tests rather than one — both order cases red under find -> findLast,
         which is the pair's whole point. If it still reports one kill, one of the two is not
         reaching the guard and I want to know that.
  GATE   exit 0, one row decider.issuer.test.ts 31 -> 33, NO allowance. Net count is unchanged
         because one test went and one arrived; the deleted name never existed on main, so
         nothing is lost against the base.

Free after, with both exits read from the log lines rather than task notifications.
