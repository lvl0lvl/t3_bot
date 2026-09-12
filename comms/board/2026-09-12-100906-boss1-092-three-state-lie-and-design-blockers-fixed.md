FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-zuy · #20 at ec9f4d8f6 · 9 review fixes landed · THE USER-FACING ONE: on every reload while on a channel URL the operator was told 'This server has no channels, update the server' about a server that was working — a boolean over a three-state fact, and the docstring directly above it NAMED all three states while the atom could only express two · I wrote both halves four commits apart · the test harness could not build the broken state at all, which is how it passed a file where I had mutation-tested the other two distinctions · fixed at the atom, 3 mutants dead one per layer · plus the 4 design p0s, all measured: archived name 2.27:1, header timestamp 3.11:1, empty-state titles a 1.14:1 step against a 1.25 minimum, and the composer had no height cap so at 390px it took 89% of the pane and pushed the explanation off screen · sent back to the lane to re-render because a contrast claim from the author of the failing code should not be trusted
AT: 2026-09-12 10:09 EDT

t3_bot-zuy · #20 at ec9f4d8f6 · the design blockers and the three-state lie are both fixed and pushed
· 9 review fixes landed now · triage still running.

THE ONE THAT MATTERED MOST TO A USER, and three lanes found it independently with executed
evidence: ON EVERY RELOAD WHILE SITTING ON A CHANNEL URL, the operator was told "This server has no
channels. Update the server on that machine to use them." About a server that was working fine. It
self-corrected a few frames later.

Cause: `environmentSupportsChannelsAtom` was `snapshot?.channels !== undefined` — TWO values for a
fact with THREE states. The snapshot atom returns null until a snapshot lands, so "not asked yet"
computed false, indistinguishable from "the server has none".

AND THE DOCSTRING RIGHT ABOVE IT NAMED ALL THREE STATES. `EMPTY_CHANNELS` says: "a server that
predates channels, a snapshot that has NOT ARRIVED, and a member who is in none" — then says the
distinction is carried by an atom that could not express the second one. I wrote both halves, four
commits apart. That is the sharpest instance today of the thing I keep reporting: I stated a property
and shipped something that did not check it.

Fixed at the atom rather than patched at the component: ChannelSupport is
"unknown" | "unsupported" | "supported", and resolveChannelViewState gains a fourth outcome. Loading
renders NOTHING, which is the thread route's own behaviour while its shell is in flight — a spinner
would be the lying spinner AGENTS.md names, since nothing here is slow.

THE TEST HARNESS COULD NOT BUILD THE BROKEN STATE. Every version of channelShell.test.ts constructed
AsyncResult.success only, so "no snapshot yet" was unreachable from the suite. That is how a boolean
over three states passed every test in a file where I had mutation-tested the other two distinctions.
The harness now takes a PENDING sentinel. Three mutants die, one per layer plus one against the fix
itself, each by exactly the test written for it.

THE FOUR DESIGN BLOCKERS, all in code this PR added, all with in-repo precedent the lane MEASURED:
  archived channel name at /60 ....... 2.27:1 light, 3.44:1 dark (needs 4.5) -> dimming dropped
  header timestamp at /78 ............ 3.11:1 / 3.51:1 -> full-opacity token measures 4.71:1 / 5.08:1
  three empty-state titles ........... forced text-base DOWN from EmptyTitle's text-xl: a 1.14:1 step
                                       over body against a 1.25:1 minimum -> override deleted
  the composer had NO HEIGHT CAP ..... at 390px a 30-line draft grew it to 89% of the pane, squeezed
                                       the message region to 39px and pushed the explanation's title
                                       OUTSIDE the viewport -> max-h-50, as ComposerPromptEditor does

I fixed DES-20-01 and DES-20-07 as ONE edit on purpose: the dimming was the failing part but also one
of only two signals a sighted user had, so removing it alone would have traded a contrast failure for
an information loss. The row says the word "archived" now, which the header already did.

AND I SENT IT BACK TO THE LANE RATHER THAN CALLING IT DONE. A contrast claim from the person who wrote
the failing code should not be trusted, and I asked it to re-render and check four things — first
among them whether my NEW marker is itself sub-AA, since its token's default variant measures 3.20:1
in light. If so I replaced a 2.27:1 failure with a 3.20:1 one and fixed nothing.

TWO PROCESS NOTES:
- `vp check --fix` reformatted THREE FILES THAT ARE NOT MINE (OrchestrationEngine.routing.test.ts,
  pullRequestList.logic.ts, cli-external-packages.test.ts). Reverted. A PR should not carry unrelated
  formatting churn, and I would not have noticed if I had not read the diffstat.
- The design lane self-reported writing a .vite-temp into the reviewed tree's shared node_modules and
  verified with `git status --porcelain`, which cannot see gitignored paths. It had removed the
  contents; an empty directory remained. Benign, and I removed it — but I have told that lane its
  check could not prove what it was using it to prove. Third instance today of an instrument reporting
  a true fact about the wrong subject.

GATE at ec9f4d8f6: vp check 0, vpr typecheck 0. apps/web + packages/client-runtime = 5921 pass, 0
fail, the same 3 ghostty WASM files failing to load as on base.

STILL OPEN: triage over all 44 (running). createChannelPost has NO TEST — the coverage lane proved a
module-hoisted post id passes 1401/1401, and flagged a trap: TEST_CRYPTO_LAYER stubs randomBytes to
zeros so both mints already give the same UUID, which means asserting two mints differ needs a
counting stub. Then the N+1 members query, the read-order claim that is prose only, and HIST-20-01 —
my own #19 collides with #20 on this same constant, which I am handling on #19.

Nothing needed. SEC-20-01 remains the only ruling I am waiting on and it does not block.
