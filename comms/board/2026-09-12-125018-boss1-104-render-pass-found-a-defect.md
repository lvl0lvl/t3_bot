FROM: boss1
TO: pm
TYPE: REPORT
RE: ajw render pass done both widths; found and fixed an empty-state placement defect; post survived a server restart. Holding lane dispatch until the 13:00 reset
AT: 2026-09-12 12:50 EDT

t3_bot-ajw · in_progress · **render pass done at both widths and it found a design defect, fixed at
`baddf1a09`** · #25 is complete and its body records the pass · holding the `/review-pr` dispatch
until the 13:00 reset, 10 minutes out · nothing blocked.

## The path works, and it survived a server restart

On this worktree's own gitignored `.t3` — ports 13975/5935, never your 5733/13773, never
`~/.t3/userdata`. Paired, seeded `#seniors` and `#project`, posted **"what is 2+2"**, and watched it
render as `@walt 12:43 PM` with the header's last-post time updating and the sidebar reordering to
most-recently-active.

Then I reloaded, and then I **stopped the dev server and started a fresh one** — the post came back
both times. So it is genuinely being read out of SQLite through the new door, not out of anything
cached or in memory. That is the demo path you want to walk after merge, working.

Dev server stopped by the PID captured at spawn, both runs.

## What rendering found that reading did not

**My empty state arrived pinned just above the composer**, with the whole pane empty above it. It
read as a stray label rather than an empty state.

`justify-end` on the scroll container is what puts posts above the composer, and it is right for
posts — a chat grows upward. It is wrong for a message about there being none. **My first fix only
lifted it about 100px**, because a `flex-1` child of the inner column has nothing to stretch
against; I had to render it twice to see that. The empty state is now returned *instead of* the
scroll container, which is what `PostsUnavailable` beside it already did.

The thing I could not have found by reading is that **the same region had two empty states with two
different placements** — and a reader sees one at a time, so nothing in the code or on screen
compares them. Fixed and re-verified by rendering.

## 390×844

Clean: no horizontal overflow, the header's channel name and last-post time fit on one line, and a
post's handle and timestamp stay on one line with the body wrapping beneath.

**The first attempt at this silently did not happen** — `resize_window` reported success and the
viewport did not change, so my earlier commit said the narrow pass was still owed rather than
claiming it. It worked on a fresh tab. Worth recording as another instrument reporting a true fact
about the wrong subject: the resize call succeeded, and the thing I wanted resized had not.

## Why I have not dispatched the lanes yet

It is 12:49 and the reset is 13:00. `hist17`, `bug17` and `api17` all died mid-run at 12:39 — one of
them while writing its findings file, which is why `review17/findings-contracts.yaml` does not
exist. Dispatching seven lanes into the last ten minutes of a limit would buy the same outcome. I
will dispatch `/review-pr` on #25 with the design lane at the reset, and `#17`'s bug-hunter
alongside it.

#25 is `baddf1a09`: `vp check` 0, `vpr typecheck` 0, `server.test.ts` 192, `channelPosts.test.ts` 9,
`apps/web/src/components` 2481, comms 77. `scratchpad/HANDOFF.md` is current.
