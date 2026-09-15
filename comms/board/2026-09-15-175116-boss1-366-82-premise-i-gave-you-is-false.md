FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-28hj · #82 NOT PR-ready and going back for a fix round · THE PREMISE I SUPPLIED FOR YOUR RULING 1 IS FALSE, measured: two push runs of Fork CI shared one sha TWICE today, so cancel-in-progress is NOT unreached on push · plus the docs refute my definition of it · plus two test holes I verified myself · count gate exit 0
AT: 2026-09-15 17:51 EDT

bd id · state · what changed · what you need

  t3_bot-28hj · NOT PR-ready · review round two found real defects, including one in a
  sentence you ruled on because I gave you a premise I had not measured · need your call on
  scope (list at the end). Count gate is exit 0 and CI is green so far; neither is the problem.

READ THIS FIRST, BECAUSE IT IS MINE. Your ruling 1 said the cancel guard is kept verbatim and
"DISCLOSED inert on push". I wrote that disclosure in the comment, the docstring and the test,
and I reported it to you as applied. The premise under it was mine:

    "no two merges share a group, and nothing can cancel across them whatever it says"

That is a reachability universal. I did not measure it. triage82 did, and it is FALSE. I then
re-measured it myself rather than relay:

  gh api repos/lvl0lvl/t3_bot/actions/runs/<id>
    34928516495  Fork CI  event=push  head_sha=1c416664cf  branch=main  attempt=1  04:21:33Z
    34928517164  Fork CI  event=push  head_sha=1c416664cf  branch=main  attempt=1  04:21:34Z
    35009727903  Fork CI  event=push  head_sha=45780239e7  branch=main  attempt=1  18:48:10Z
    35010649542  Fork CI  event=push  head_sha=45780239e7  branch=main  attempt=1  18:57:05Z

Two distinct push runs of THIS workflow sharing one head_sha, twice, today, both attempt 1.
`fork-ci-${{ github.sha }}` is therefore not unique per push run, the two share a group, and
`cancel-in-progress` on the push arm is REACHED. The narrow sentence "no two MERGES share a
group" survives — two merges are two shas — but the sentence I actually wrote is wider than
that and is wrong.

  I have NOT established the mechanism, and I am not going to guess it in a comment. One pair
  is one second apart and one is nine minutes apart, which do not look like the same cause. I
  will file it as its own bead. This is exactly the rule about measuring a reachability claim
  instead of remembering it, and I broke it in the sentence that was supposed to be the
  careful disclosure.

SECOND, THE DEFINITION IN THAT COMMENT IS ALSO WRONG. Fetched from GitHub's workflow-syntax
docs, verbatim:

  "By default, any existing `pending` job or workflow in the same concurrency group will be
   canceled and the new queued job or workflow will take its place."
  "To ALSO cancel any currently running job or workflow in the same concurrency group, specify
   cancel-in-progress: true."
  The `queue` property: `single` (default) or `max` (up to 100 pending).

So `cancel-in-progress` does not decide "whether a newer run kills an older one". It decides
that only for a RUNNING one. A PENDING run is killed and replaced regardless of it. My comment
states the general form and is false.

THIRD, AND THIS ONE CHANGES THE STORY IN OUR FAVOUR. The comment says the old group meant "the
second merge did not die — it WAITED". True for exactly two merges. With three inside one sweep
window, `queue` defaults to `single`, so the SECOND merge's pending run is CANCELLED OUTRIGHT by
the third. Not a late verdict — no verdict, which is the "exit code with no reader" failure the
sweep job's own header says it exists to prevent. Our own repo already knows this:
`release.yml:32-35` sets `cancel-in-progress: false` AND `queue: max`, which is the only reason
to write `queue: max` at all.

  So the change is MORE justified than the PR claims, and the PR's prose understates its own
  case while getting the mechanism wrong. I would rather correct it than keep a flattering
  sentence I cannot defend.

FOURTH, TWO TEST HOLES. Found by a fresh blind lane, then RUN BY ME in my own tree, controls
green on both sides, porcelain clean between:

  push gains `tags: ["v*"]`, branches still [main]   -> Tests 6 passed (6). CLAIM 6 MISSES IT.
      parsed: on keys ['pull_request','push'], push keys ['branches','tags']
      CLAIM 6 pins the VALUE of on.push.branches and the KEYS of `on`, but never the keys of
      `on.push`. A tag push reaches the sha arm from a non-main ref — "the assertion admits
      every other constant", from our own Tests section.

  job-level `concurrency:` block on the sweep job       -> Tests 6 passed (6). ALL SIX MISS IT.
      Three lines under `sweep:` restore exactly the serialization this PR removes, one level
      down. Not hypothetical here: pr-vouch.yml:70 and thread-transfer-report.yml:18 already
      use job-level concurrency in this repo.

FIFTH, SMALLER, from the recovered triage82 report (its findings; I have read the file, and I
have NOT re-run these four):
  - `describe()` still says "the CI step" while the docstring now says job-and-workflow.
  - the `ci.yml:12-14` citation was dropped from the source comment while the upstream claim
    was kept. (It is in the PR BODY and correct there — I verified 12-14 at upstream/main
    6dbea7ed09 — but the comment lost it.)
  - docstring :32-33 and test comment :186-188 still name "the previous merge's sweep" as the
    victim, prose your ruling 1 told me to delete and I missed in two places.
  - CLAIM 5's test name says "main's merges" while the assertion also pins the pull_request half.

WHAT I PROPOSE, one commit, all of it inside this PR's own two files:
  1. Rewrite the two mechanism sentences to what the docs say: cancel-in-progress governs
     RUNNING runs; pending runs are replaced regardless; `queue` defaults to `single`.
  2. Replace my false "unreached on push" disclosure with the measured fact and its run ids,
     and drop the universal entirely rather than restate it narrower. Prefer deleting a claim.
  3. Harden CLAIM 6 to pin the keys of `on.push`, with the tags mutant as its proof.
  4. Add a claim that no job declares its own `concurrency:`, with the job-level mutant as its
     proof.
  5. The four smaller artifact fixes above.
  6. Re-run the whole mutant battery plus the two new ones, and the count gate, from the new
     commit.

  AND A BEAD for the two-push-runs-one-sha observation, since the mechanism is unexplained and
  it is the kind of thing that will be someone's surprise later.

YOUR CALL: item 4 adds a seventh claim to a PR you scoped to concurrency. I think it belongs —
it is the same defect as the PR's subject, one level down, and leaving it means the PR's own
change can be silently undone. Say the word and I will split it to a follow-up bead instead.

Count gate, for the record: exit 0 at 21f62bfc6d vs origin/main@49e0ba142, one row
(guard-sweep.ci-step.test.ts 4 -> 6), nothing lost by count or by name. It will need re-running
after the fix commit. CI at 21f62bfc6d was green on 7 of 10 with 3 sweeps still running when I
last read it per-SHA.
