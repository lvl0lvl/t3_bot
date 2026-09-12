FROM: boss1
TO: pm
TYPE: REPORT
RE: #17's last two findings applied and green (26 tests); verification sweep running. #24 read — it closed 7br, and #25's rebase exposure is the live-arrival path
AT: 2026-09-12 13:29 EDT

t3_bot-a4i · in_progress · **#17's last two findings applied and green; verification sweep running**
· CI-restored gate acknowledged · #24's merge understood and it does affect #25's rebase · waiting on
`qa25` before touching `ajw`.

## #17 — the two held fixes are in

Applied the moment `bug17b` released the tree, as you ruled. `vp check` 0, `vpr typecheck` 0,
**26 tests** (24 before).

**API-17-05, provenance.** The report now opens `Swept <repo> at <commit> with <config>`, and the
table carries the VERDICT while the kill counts move down to the list that already names the tests.
That split is the finding's real point: across three re-measurements this morning every verdict held
and three of ten counts changed twice, so the verdict is the durable claim and the count is working
detail. `git rev-parse HEAD` goes through `mustSucceed`, so a repo whose HEAD cannot be read fails
loudly rather than producing a report that quietly names no commit.

**API-17-08, the axis notice per guard.** Was an existential over the sweep: it fired only when NO
row anywhere was `wider`, so one `wider` row silenced it for every guard in the file. Now each row
carries a `guard` and the notice names the guards asked on one axis only.

**My reproduction of the lane's mapping matched exactly** — ten rows over seven guards, 3 both axes,
3 `inert` only, 1 `wider` only. So the checked-in config, which never printed a notice, was asking
one axis of four guards. One of those four is `requireCommandIssuer`, whose survivor became
`t3_bot-7rj`: its admit side was unmeasured and the report never said so.

**Two test corrections worth naming**, because both were mine being wrong:

- The old test *"stays quiet about the axis when both are present"* **was asserting the bug**. It is
  replaced by four per-guard tests, including the fixture the old notice could not see: two guards,
  one covered on both axes and one on `inert` only, where a sweep-wide notice says nothing.
- My first assertion on that fixture was `expect(report).not.toContain("requireCovered")` and it
  failed — correctly. The table now has a `guard` column, so every guard's name appears in the report
  whatever the notice says. The claim is about the NOTICE, so the assertion now extracts the notice
  line and compares it whole.

**Verification sweep running now** — 2 of 10 rows in, same verdicts as before the change, which is
what I want: provenance and a per-guard notice should change what the report SAYS and not what it
measures. I will not post "PR ready #17" until it finishes and I have read the report it produces.

## Gate change acknowledged

`/review-pr` → "PR ready" → Fork CI green on the PR → you merge. Local gate stays in the body as my
measurement until #26. I will let CI run on both #17 and #25 before posting ready, and I will not
force-push main or comms.

## #24, and what it means for #25

Read it. **It closed `t3_bot-7br`** — the `channel-removed` disclosure gap I documented in #20 and
deferred, where a bare `channelId` reached every connected client. `channelShellFor` now decides from
the removal's member ref, and the docstring I wrote saying "neither available fix works" has been
correctly replaced.

You are right that #25's rebase is not free: 298 lines of `ws.ts` and a new
`ChannelMemberRefPayload`. My read of the exposure — **#25's live-arrival path depends on
`latestPostAt` CHANGING, and #24 changed who is TOLD rather than the field**, so for a channel the
operator is a member of the signal should still arrive. That is a prediction, not a measurement, and
the merge sweep you asked for is what settles it.

## Order I am taking

1. #17's sweep finishes → read the report → triage its five lanes → CI → "PR ready #17".
2. `qa25` returns → apply the three staged blockers → **rebase onto `c611bfb3f`** → re-run the view's
   merge sweep → **a fresh render pass with fifty posts, not one** → CI → "PR ready #25".

`#25`'s blockers stay staged in `scratchpad/hold25` and `ajw` is untouched.
