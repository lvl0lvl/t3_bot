FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-zuy · #20 at 47bae42ec · 11 fixes landed · createChannelPost had NO test and a module-hoisted post id passed 1401/1401 — now pinned, both mutants dead · the trap worth reading: the existing crypto stub returns all zeros so two mints ALREADY collide, meaning 'assert the post ids differ' would have FAILED against the correct code and passed against nothing; a counting stub is what makes it mean anything · design lane re-rendered: all four p0s PASS, my archived marker is 4.62:1 not the 3.20:1 I feared (token mix-up), composer region 39px->567px · but checking the lane found ANOTHER of mine: it attributed the description's 3.11:1 to the primitive, which actually measures 4.71:1 — the /78 was on two of my own lines · it also caught a false comment I wrote in the same session as the commit fixing five false comments · one finding DECLINED because the repo forbids the fix: no-native-title-tooltip is an error, so the truncation gap is recorded not patched
AT: 2026-09-12 10:17 EDT

t3_bot-zuy · #20 at 47bae42ec · 11 review fixes landed · the post-id gap is closed, and the design
lane's rendered re-verification came back ALL FOUR p0s PASS.

createChannelPost HAD NO TEST AT ALL, and the coverage lane proved it rather than asserting it:
hoisting the post id so the module mints ONE for its lifetime passes 1401/1401 client-runtime tests.
The docstring says that loses a message — the aggregate does not refuse a post id it has seen, so two
commands carrying one id both commit while the projection keeps the first, and the second post wakes
an agent with nothing readable behind it. Two tests now; both mutants die by name, including that
exact hoist.

THE TRAP IN IT IS WORTH YOUR ATTENTION because it is a test that would have LOOKED right and proved
the opposite. The existing crypto stub returns all zeros, so every generated UUID is
00000000-0000-4000-8000-000000000000 and TWO MINTS ALREADY COLLIDE UNDER IT. "Assert the two post ids
differ" would therefore have FAILED against the correct implementation and passed against nothing.
The lane flagged it in advance; a counting stub that fills each request with an incrementing byte is
what makes the assertion mean what it says. That is the sharpest example today of choosing the fixture
from the property rather than from what reads naturally.

THE DESIGN RE-VERIFICATION, rendered in real chromium at both widths and both themes:
  the new archived marker ... 4.62:1 light / 8.33:1 dark — PASS. My worry was a token mix-up: the
                              3.20:1 figure is the OPACITY-MODIFIED variant, mine is the token at full
                              opacity, a different colour. Margin is only +0.12 in light, so any future
                              darkening of --sidebar flips it.
  ms-auto vs the name ....... no collision at any width; overlap negative everywhere
  the composer cap .......... message region 39px -> 567px, title back inside the viewport
  EmptyTitle ................ confirmed 20px, a 1.429 step over body

AND CHECKING THE LANE RATHER THAN ACCEPTING IT FOUND ONE MORE OF MINE. It attributed the empty-state
description's 3.11:1 to the EmptyDescription primitive. It is not inherited — the primitive is plain
text-muted-foreground, which that same render measured at 4.71:1 and PASSING. I had put /78 on two of
my own lines. Same failure as the header timestamp, same fix. Every AA failure in that component turned
out to be an opacity modifier I added to an already-muted token; there are none left.

IT ALSO CAUGHT A FALSE COMMENT I WROTE IN THE SAME SESSION AS THE COMMIT FIXING FIVE FALSE COMMENTS.
Textarea forwards className to its outer WRAPPER, so the control's own max-height stays none and the
wrapper does the bounding — unlike ComposerPromptEditor, which caps the scrolling element itself. The
behaviour was right; the mechanism I described did not exist.

ONE FINDING I DECLINED, and the repo decided it for me. The render surfaced that two archived channels
with a long common prefix both truncate to "retired-laun… archived" at the 208px floor. I reached for a
native title attribute and t3code/no-native-title-tooltip is an ERROR in vite.config.ts — the lint
gate caught a decision already made. Fixing it properly means widening SidebarMenuButton's tooltip
condition, which EVERY truncating row in the app shares and which is not this channel list's call.
Recorded in a comment naming where it lives, not patched here.

THREE FIXES TO MY OWN TOOLING, because it kept producing answers that looked right:
- sweeplib now refuses a dirty tree, a non-unique anchor, a mutant identical to the original, a
  non-green baseline, and a kill inferred from an exit code when NO TEST RAN.
- It was rejecting legitimate ADDITIVE mutants: it asserted the anchor was gone, but prepending a
  declaration keeps it. Fixed.
- And I burned four attempts on one edit because an 8-space anchor is a substring of the 10-space copy
  of the same line — rule 1 of guard-sweep.ts, reappearing inside my patch script — then hit index
  invalidation by editing an earlier region before a later one. Whole-line anchors and recomputed
  spans now.

GATE at 47bae42ec: vp check 0, typecheck 0, packages 1797 pass / 0 fail.

STILL OPEN: triage over all 44 (running). The N+1 members query (two lanes), the read-order claim that
is prose only, and HIST-20-01 — my own #19 adds a second constant for this same value and rewrites the
same two ws.ts lines, which I am handling on #19 rather than here.

SEC-20-01 remains the only ruling I need and it does not block.
