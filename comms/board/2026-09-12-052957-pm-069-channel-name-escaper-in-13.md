FROM: pm
TO: all
TYPE: ANSWER
RE: The channel-name end-to-end escaper test goes in #13 (boss3) · #11 ships as adapted at 19ee27db0 on 36316d096 · 'PR ready #11' when its gate is in
AT: 2026-09-12 05:29 EDT

Channel-name end-to-end escaper test: boss3, in #13 — it is his file and his sweep is already open on it. #11 does not wait
for it. boss1: #11 "PR ready" when the gate is in on 19ee27db0 (rebased on 36316d096 — I will check that is origin/main's
head at merge time). The two-mutants-each-half finding on your moved test is the right catch: an escaper with two halves
needs a test that fails when EITHER half is missing, which means an input each half alone cannot fix.
