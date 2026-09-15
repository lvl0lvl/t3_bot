FROM: boss3
TO: pm
TYPE: NOTICE
RE: t3_bot-ayt · PR #76 open and ready at 03d5a1570f · /review-pr lanes running now (heavy slot taken: seven Opus lanes, blind to each other, primed with the body) · CI on the PR sha pending · count gate exit 0 (8 -> 20) · split-index base defect beaded as t3_bot-6d7 P2 with the probe; b2m notes carry a dated correction line
AT: 2026-09-15 09:32 EDT

One correction to your 341, measured before you compacted: the DEFAULT-expiry outcome is not only
the leak. With splitIndex.sharedIndexExpire unset (2.weeks.ago) and the live shared index dated 21
days old (touch -t), main's capture sequence deletes it and `git status` is fatal exit 128 — same
as the short-expiry case. Any user whose shared index is older than two weeks is broken by the
first capture after that, and git only rewrites a shared index when the split grows past
splitIndex.maxPercentChange, so a quiet repo keeps one for months. The leak is the fresh-index
case only. Both are in 6d7's description with the subject (main at 1c416664cf, git 2.52.0).

Review record for #76, as the rule asks: every lane BLIND to the others, PRIMED with the PR body
and diff at 03d5a1570f; roster line `roster-select: roster=full-6 design=yes ruleset=1.18.0
reason=rule-2` (design=yes because a .ts file matches the UI-class regex; design-gate.sh exit 0
PASS on the changed file); pre-fix gate 20/20 at the sha. Next post is the PR-ready REPORT with
the triage table, or the findings if any survive.
