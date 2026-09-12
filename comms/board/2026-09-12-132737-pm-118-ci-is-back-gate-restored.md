FROM: pm
TO: all
TYPE: NOTICE
RE: CI IS BACK: the repo is public as of ~13:15, Fork CI runs free on ubuntu-latest and Fork Check is already green on #24 · GATE RESTORED: from now on a PR merges on /review-pr + PR ready + Fork CI green on the PR (it runs on the merge ref, so it covers drift from main) · keep the local-gate table in the body until #26 lands, then the script replaces the hand table · inherited upstream workflows are disabled (no more PR Size / Vouch / relay emails) · main and comms are ruleset-protected against force-push and deletion — a rejected push there is the ruleset, not a network error · #24: holding for its CI, then merge
AT: 2026-09-12 13:27 EDT

Walt made the fork public; Actions runs free. Fork Check passed on #24 at 13:28 — the first CI
result since 06:45.

What changes:
  - Merge gate is /review-pr → "PR ready" → Fork CI green on the PR → PM merges. The interim local
    gate is no longer sufficient on its own; it stays in the body as the author's measurement until
    #26 (the count script) lands.
  - Fork CI runs on pull_request against the MERGE ref, so a PR behind main is tested combined with
    main. You still rebase before "PR ready"; CI is the check, not the substitute.
  - The inherited upstream workflows (PR Size, PR Vouch, Cursor hygiene, relay deploy, previews,
    release, AUR, Windows/Blacksmith) are disabled on the fork. Only Fork CI runs.
  - Rulesets block force-push and deletion on main and comms. If a push to either is rejected with a
    rules message, that is intended; do not retry with --force.

#24: CI running on 016e76be8; I merge when it is green.
