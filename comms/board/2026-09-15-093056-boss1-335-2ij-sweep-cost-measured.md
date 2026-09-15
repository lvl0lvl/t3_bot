FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-2ij · the number: 28m serial / ~12m as a six-way matrix, LOCAL not CI · plus a pipefail finding and an instrument error of mine
AT: 2026-09-15 09:30 EDT

bd t3_bot-2ij · in_progress · six-config cost measured · need: one ruling, at the bottom.

THE NUMBER, and first its subject, because you will otherwise inherit it as a CI figure:

  MEASURED ON THIS MAC, NOT ON ubuntu-latest. You asked what six configs cost IN CI. I measured local
  wall-clock. I am not scaling it to CI by a guessed factor — that would be a constructed value
  standing in for a read one, which is the (c) clause we landed at 00:28. What this licenses is the
  RATIO between configs and the SHAPE of the job; the absolute CI number needs one real CI run, and
  I will get it from the first push of the branch.

  head 1c416664cf, each exit code captured from the sweep itself, immediately, before any other
  command ran:

    config               rows   exit   wall
    channel-cursor        18     0     101s
    channel-invariants    18     0     476s
    channel-post-wake     17     0     172s
    colliding-roster      17     0     699s   <- slowest
    invariant-reason      14     0     143s
    workflow-script       14     0      91s
    -----------------------------------------
    98 rows, 6/6 exit 0, 0 survivors, 0 NOT RUN, TOTAL 1682s = 28m SERIAL

  One job, six configs in sequence: 28m. Six parallel jobs, one config each: wall = the slowest
  config, 699s ~= 12m, at 28m of runner-minutes. Existing fork-ci timeouts are 15m (check) and 20m
  (test_server), so the serial shape does not fit under the house timeout and the matrix shape does,
  with room.

MY PRIOR WAS WRONG AND I AM RETRACTING IT. I told you at 09:02 that per-config pnpm install was
probably the large share because the tool installs into a fresh scratch worktree every invocation.
The install part is true — Flag.file("config") is single-valued, so six configs is six installs — but
it is NOT the driver. Install is ~21s (observed once, from the count gate's own setup line); six of
those is ~126s of 1682s, under 8%. The driver is TEST BREADTH PER MUTANT, which is the next item.

AN INSTRUMENT ERROR OF MINE, disclosed because it changes a conclusion I was about to bring you.
My script counted each config's test files by filtering testCommand for args ending in ".ts". Two
configs do not pass files, THEY PASS DIRECTORIES, so the filter silently dropped them and reported
channel-invariants as "testfiles=0". A zero next to 476 seconds is what caught it; the seconds were
right.

  TRUE TARGET SET: 11 entries, 9 explicit files plus TWO DIRECTORIES —
     apps/server/src/orchestration            51 test files under it today   (channel-invariants)
     apps/server/src/mcp/toolkits/comms        5 test files under it today   (two configs)

  That is the cost: channel-invariants runs the WHOLE orchestration directory once per mutant, 36
  runs, hence 476s; colliding-roster runs 5 files including server.test.ts, hence 699s.

  AND IT KILLS THE OPTION I WAS GOING TO OFFER YOU. I had a fine-grained path filter in mind —
  trigger each config only when its own targets change. With two configs watching directories, that
  filter would have to trigger on essentially all of apps/server/src/orchestration, source and tests
  both. A per-config filter would be almost-always-true and would look precise while being neither.
  I would have proposed it on a false premise an hour ago.

A FINDING THAT IS DIRECTLY THIS BEAD'S REQUIREMENT, and it is demonstrable rather than argued.
GitHub's default shell for a run: step is `bash -e {0}` — no pipefail. So:

    false | tee log     ->  the step sees exit 0

I ran it. A sweep piped to tee for log capture GOES GREEN OVER A TOOL THAT EXITED 1 — the same false
green as qa29's PIPESTATUS and my harness "completed (exit code 0)", now reproduced in the medium the
fix will live in. The repo already has the counter-idiom: 14 `set -euo pipefail` lines across
existing workflows (release, desktop-macos-preview, web-preview, cursor-hygiene-webhook; ci.yml:234
uses `set -uo pipefail` without -e). So the step will either not pipe at all, or set pipefail
explicitly, and the PR will carry the one-line proof above rather than the assertion.

THE RULING I NEED, and it is the one you named:

  (A) SIX-WAY MATRIX, one config per job, mirroring test_server's existing matrix idiom. ~12m wall,
      28m runner-minutes per PR, fits the 20m house timeout, and a red job names the broken config in
      its own title. My recommendation.
  (B) ONE JOB, six sequential. 28m wall, needs timeout raised past the house 20m, one red job for any
      config.

  And the sub-question, which is yours because it is scope: a COARSE path filter at job level
  (apps/server/**, scripts/guard-sweep*.json, the workflow file) so a docs-only PR does not pay six
  runners. It is safe at that granularity in a way the per-config filter was not. The catch, and the
  reason I am not just doing it: if the sweep becomes a REQUIRED check, a paths filter that does not
  match leaves it never-run rather than green, and required-plus-paths is a known GitHub trap. That
  interacts with your merge gate, so it is your call, not mine.

Heavy slot released. Branch boss1/t3_bot-2ij-sweep-in-ci exists at 1c416664cf, nothing committed yet.
