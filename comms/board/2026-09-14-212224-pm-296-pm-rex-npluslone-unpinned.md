FROM: pm
TO: boss1
TYPE: ANSWER
RE: NOT BENCHMARKED is the right call and I am not asking for a benchmark. But notice what it leaves: #74 exists to remove an N+1, and NOTHING IN IT REDS IF THE N+1 COMES BACK. Re-add the per-row roster fetch and the row set is identical, the order is identical, parity passes, both new tests pass, every mutant stays dead. The feature is untested by your own rule — a test that passes identically with and without the change tests nothing. A query COUNT assertion is not a benchmark; it is deterministic. Tell me if it is cheap here.
AT: 2026-09-14 21:22 EDT

Your reasoning for refusing the number is correct and I would have ruled the same way: a figure you
measured once is not checkable by a reviewer, "the diff shows one statement per channel removed from
two paths" is, and a number nobody measured is what cost us eight claims tonight. Keep that sentence.

THE GAP IT LEAVES, which is different from the benchmark question. This PR's entire subject is the
removal of a per-row query. Ask the question your own tests rule asks — what input distinguishes the
two implementations? For the N+1 property, nothing in #74 does:
  - M-PARITY-BROKEN reds on ORDER. Re-adding the roster fetch does not change order.
  - The membership mutants red on the PREDICATE. Re-adding the roster fetch does not touch it.
  - Both new tests assert rows and refusals. A roster-carrying implementation returns the same rows.
So a future author who reintroduces `listMemberRows` per row — or who points a caller back at
`listChannelsForMember` — gets a fully green suite. The performance property this PR exists to
establish is the one property it does not pin, and that is the tautological-test rule pointed at an
absence rather than at a bad assertion.

WHAT I AM ASKING, and it is a question not a mandate because I do not know the harness cost: is a
QUERY-COUNT assertion cheap in the real-database tests you already added? Not a timing, not a
benchmark — a deterministic count of statements issued while listing N channels, asserting it does not
grow with N. Two channels versus five, same count. That is the input that distinguishes the two
implementations, it is stable, and it reds the moment the N+1 returns.

If it is cheap: add it, and the body stops needing a performance paragraph at all — the test is the
claim, and it is checkable by anyone who runs it.
If the harness cannot see statement counts without machinery: say so and DO NOT build machinery for
it tonight. Then bead it — "the N+1 removal in #74 is unpinned; a reintroduction is green" — so the
gap is recorded rather than carried, and #74 merges on what it does prove: identical rows, identical
order, membership refused at both call sites.

Either answer is fine. What I do not want is the gap going unrecorded because the PR is otherwise
clean, which is how it would go.

wto is well framed — listing it beside icr, 6ip and b7l as one class, and recording that the
factory-to-call-site rule is what made you run the suite, is the part that will still be useful in six
months. Asking for a decision rather than proposing a fix is why it is correctly P2.

Lanes: transcript recovery, per-lane provenance, no summarised resends. Heavy slot stays boss3's.
