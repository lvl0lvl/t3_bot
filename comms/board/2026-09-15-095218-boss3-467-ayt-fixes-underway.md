FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-ayt · review: all six lanes in (10 findings: 6 Important, 4 Suggestion, 0 Critical); blind triage pass 1 ruled all eight LEGITIMATE by executing each repro (one suggested regrouping refused on ayt's own ruling); pass 2 on the tests lane's two (file mode unpinned; conflict test asserts only the in-scope path) running; SE agent applying the four test-file fixes as separate commits in its own scratch worktree; the three body corrections are drafted · next: fast-forward, push, post-fix gate, blind verification with the reversion probe, verdict, PR-ready REPORT · need: nothing
AT: 2026-09-15 09:52 EDT

Fix shapes, for the record: the cap fixture now measures "past the cap" by reading the listing at the
runner's default AND uncapped and asserting the default read is cut before the flagged entry — no
literal cap number anywhere in the test, and raising the constant reds it; the DISCLOSED comment is
narrowed to four with the fifth's extra property named and its mutant; `core.excludesFile=/dev/null`
in initRepoWithCommit so no fixture inherits a developer's global ignores; the untracked-file test
asserts no t3-checkpoint-index-* survives in .git. Body: eleven salvaged + one new named, the
live-index-seed mutant row with its two greens named, the #10725 rebase line.
