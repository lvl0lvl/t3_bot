FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-dhg · in_progress · #48 lanes 7/7 in, synthesized 16 findings, gate FAIL (0 Critical / 7 Important / 8 Suggestion), blind triage running · Important: the control has no surface (design p0, measured — fix: adopt ChatView's glass Scroll-to-end pill recipe), label lies after a manual scroll (fix: retire via IntersectionObserver on the existing sentinel), a silent history hole after a 50+ post outage (bug+contracts executed — fix: restart at the newest page, or a seam control if you prefer), newest-atom failure silent (same class as ssz), three of my tests weaker than they read (surviving mutants) · one question in the body: seam vs restart for the hole · need: your preference on that, else I take restart
AT: 2026-09-13 11:13 EDT

**#48: all seven lanes in, synthesized, blind triage running.** Gate on the synthesized set: FAIL — 0 Critical, 7 Important, 8 Suggestion, 1 below the matrix. That is the pipeline working; the fix round follows triage.

The Important ones, and what I intend if triage confirms them:
- **The control has no surface** (design, p0, measured in four headless runs): `variant="secondary"` is 3% white in dark, so `New posts` paints straight over a post line; 1.05:1 boundaryless in light. Two lanes independently point at the fix already in the app — `ChatView`'s glass `Scroll to end` pill (absolutely positioned, rounded, chevron). I will adopt that recipe and keep this PR's trigger.
- **The label lies after a manual scroll** (design): it stays lit until clicked even when the reader scrolled to the newest post by hand. Fix: retire it when the bottom sentinel comes into view — an IntersectionObserver on the ref the region already has, not a scroll handler (cdo stays boss3's).
- **A silent hole in history** (bug + contracts, both executed): a paged-up reader whose socket drops while 50+ posts land gets the newest 50 merged after the held set with a gap the merge cannot fill, because it drops the newest page's cursor. Fix I intend: detect "the newest page's oldest post is not held" and restart the region at the newest page — a seam control that fetches into the middle of the list is machinery for an outage case, and a restart is honest and small. Your call if you want the seam instead.
- **The newest atom's failure is read nowhere** (history, escalated): a failed newest read while paged up is silent — the same class as `ssz`, my next bead, but this PR opens a second path. Triage rules whether it lands here or in ssz.
- **Three of my new tests are weaker than they read** (QA, each with a surviving mutant): the refresh counter cannot tell the newest atom from the pager's; nothing observes the scroll (fixable — react-test-renderer's `createNodeMock` can hand the sentinel a `scrollIntoView` spy); `moreAbove` from the newest merge is unpinned.

Security: 0, amplification bound executed. Quality/history: stale #25 comment, a duplicate bead pointer (`ef1` and `cdo` name the same deferral — one of them should close), state declared away from the block, a test helper bypassed.
