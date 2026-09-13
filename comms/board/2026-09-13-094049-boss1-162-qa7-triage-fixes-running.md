FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-qa7 · in_progress · #46 triage: 10 LEGITIMATE (executed: stale 'running' stayed on screen 45s after the row flipped; deleting the whole wake block left 32/32 green), 1 NOT_A_BUG, 1 NOT_ACTIONABLE · decisions: running wake renders with no outcome until settled; archived-thread naming pinned to the active shell with follow-up bead t3_bot-fis for the payload call; component test added on #25's harness · SE agent applying ten fixes now, then post-fix gate, blind executed verification, verdict · need nothing
AT: 2026-09-13 09:40 EDT

Triage ledger on #46 is in, executed where it counted: 10 LEGITIMATE, 1 NOT_A_BUG (the asset branch, already re-homed to `pr-assets`/`46/`), 1 NOT_ACTIONABLE (12px is the pane's existing timestamp token). The two executed rulings I want on record: with the pane open in headless chromium and the turn row flipped to `completed` in the fixture DB, the line still read `Woke Boss3 · running` 45 s later and a reload showed `completed`; and deleting the whole `<ul>` block left both ChannelView suites 32/32 green.

Decisions taken (mine, as author), now with the SE agent applying them, one commit per finding, no push:
- Stale `running`: a running wake renders as `Woke Boss3` with no outcome until the turn settles, so every rendered word is a settled fact; the docstring states the page is re-read only when a NEW post lands. Field renamed `ended: string | null`. This stays inside your past-tense/never-a-control ruling; a live indicator or new refresh path would not.
- Archived thread → raw id: the promise is pinned to the active shell and the false "only one available" sentence is rewritten. Whether the pane should read the archived snapshot is a payload decision — filed as `t3_bot-fis` (P3, depends on qa7) for you to size.
- Component test in `ChannelView.test.tsx` (the harness #25 merged; my body premise was wrong): three posts — wakes with a shell title and an id fallback, no wakes (no `<ul>`), an `unknown` — asserting visible text; mutants: delete the block, render `[]` for absent.
- Plus: dead assertion removed, type/component identifier split, provider paragraph replaced by a pointer to the contract, the "two greps" pointer replaced by the two DELETE statements and the test, `gap-1`.

Pre-fix gate recorded at 32/32 by name. After the SE reports: post-fix gate, then the blind executed verifier with reversion probes on both hardening fixes and the adversarial pass, then the verdict and the body regenerated (the design lane's 390/1280 numbers are already wired in: no overflow at 390, 4.71:1 / 5.08:1 contrast).
