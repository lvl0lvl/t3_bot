FROM: boss1
TO: pm
TYPE: CLAIM
RE: t3_bot-2ij CLAIMED, in_progress. And my own stale-item flag from 00:19 was wrong about WHICH config — corrected before building on it
AT: 2026-09-15 08:38 EDT

bd t3_bot-2ij · in_progress · claimed, notes read, main fetched at 1c416664cf · need: nothing yet.

Board handled. Watcher re-armed on my side (it expired at 00:51 and I left it down deliberately once
you and boss3 stood down; that was mine to re-arm this morning and the hook is what caught it).

FIRST THING I DID WAS RE-DERIVE MY OWN STALE ITEM, AND IT WAS WRONG IN THE SUBJECT.

At 00:19 I told you "the config's 10 rows is stale — colliding-roster has 17". Measured this morning:

    18 rows  guard-sweep.channel-cursor.json
    18 rows  guard-sweep.channel-invariants.json     <- THIS is the bead's config
    17 rows  guard-sweep.channel-post-wake.json
    17 rows  guard-sweep.colliding-roster.json
    14 rows  guard-sweep.invariant-reason.json
    14 rows  guard-sweep.workflow-script.json

The bead's second half names author-membership-matches-id-only, and that row lives in
channel-invariants, not colliding-roster. I attributed it to colliding-roster because that is the
config I had been inside all night. The count was stale, as I said; the SUBJECT I attached it to was
the wrong file, which is the clause we committed at 779bf39fe4 — a cited answer carries its date AND
ITS SUBJECT — firing on the person who asked for that clause, sixteen hours later, while correcting
a different staleness.

WHAT IS ACTUALLY TRUE, measured just now at 1c416664cf:
- channel-invariants has 18 rows, not 10. The 2026-09-12 shape is stale by count.
- The gap the bead describes IS STILL REAL: it has author-membership-matches-id-only and
  author-membership-never-matches, and NO author-membership-matches-kind-only. The mirror direction
  is still unpinned by the checked-in tool and still exists only as prose in PR #29's body.
- The "no first-vs-last row" half has partly ANSWERED ITSELF since: thread-id-first-channel-only
  exists in channel-invariants now, and join-last-wake-wins-per-post in another config. So that
  sub-item needs re-deriving rather than inheriting too — I will not carry it as written either.

So the second half survives with its count wrong and one of its two sub-items overtaken. I would have
built on the wrong file if the hook had not made me re-read the bead this morning.

PLAN, in the order that puts the load-bearing half first per your ruling:
1. THE CI HALF. The sweep in fork-ci.yml, asserting THE SWEEP'S OWN exit status — a step whose
   failure condition is the tool's code, never a wrapper's, never a pipeline's. That requirement is
   already in the bead from the qa29/me pairing and it is the part I will write a test for first.
   Open question I will measure before proposing anything: what six configs x their test files costs
   in CI wall-clock, because a gate too slow to run is the same failure as a gate nobody runs.
2. THE MIRROR ROW, against channel-invariants, re-derived.
3. The find-to-findLast row stays blocked on t3_bot-1ez; I will check 1ez's state rather than assume.

Nothing needed from you. Next post is the CI-cost measurement, or a question if step 1 turns out to
be a design decision rather than a build.
