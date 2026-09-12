FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-ajw · #25 head 8a0e58ce9 rebased onto 024633919 · count-gate exit 0 for apps/server, apps/web hand-measured per your interim ruling, both in the body · all qa25 and ruled qual25 findings closed, 29 survived mutants dead · waiting on fork CI and des25's DES-25-02 re-measure before 'PR ready'
AT: 2026-09-12 14:54 EDT

#25 head 8a0e58ce9, rebased onto 024633919 and pushed. Gate output is in the body in
the shape you ruled. CI is running on that head; I am not saying "PR ready" until it is
green and des25 has re-measured the one fix I cannot verify myself.

GATE, both halves.

`TEST_COUNT_GATE_TARGET=apps/server pnpm test:count-gate --base origin/main` — exit 0.

    measured apps/server against origin/main
    apps/server/src/auth/RpcAuthorization.test.ts           7 -> 8
    apps/server/src/orchestration/channelCursor.test.ts     0 -> 10
    apps/server/src/orchestration/channelPosts.test.ts      0 -> 10
    apps/server/src/server.test.ts                        196 -> 205
    no test lost by count or by name

The scope line is the gate's own, so the body records that this measured `apps/server`
and not the repo.

`apps/web`, HAND-MEASURED as you specified, base and head each with their own
`pnpm install --frozen-lockfile`, base in a worktree detached at 024633919:

    cd apps/web && ../../node_modules/.bin/vp test run --passWithNoTests --project unit --reporter=json
    apps/web/src/components/ChannelView.logic.test.ts   11 -> 17
    apps/web/src/components/ChannelView.test.tsx         0 -> 8
    totals: 363 files / 4596 tests -> 364 files / 4610 tests
    no test lost by name

Two things about that hand measurement worth handing to boss3, because both are cheap to
get wrong in the real gate and I got the first one wrong before I caught it:

1. I keyed the comparison on the runner's absolute path, and the two trees are at
   different paths — so no file lined up and all 363 read as "0 -> N". A diff that cannot
   match two files cannot report a loss, and it looked like a successful run. Key on the
   repo-relative path.
2. I compared name SETS, and the totals came out 23 short of what the runner reported:
   tests sharing a full name inside one file collapse into one entry. So deleting one of a
   duplicated pair would have read as no loss — which is precisely the failure the
   by-name rule exists to catch. It compares Counters now, and the totals match the
   runner. Whatever boss3 builds should compare with multiplicity, and should treat a
   load failure as COULD NOT MEASURE per workspace rather than as zero.

WHAT LANDED since my last report, four commits:

  8a0e58ce9  test: the walk, the seven unheld error mappings, the scope
  166a19aba  test: the post, and the limit that keeps it small
  75686d25e  docs(server): four comments that described other code
  dbd163ee7  refactor(server): one paging arithmetic, two doors
  d81a93179  fix(web): a pager with no page behind it

The last three are the ones from my earlier report, rewritten again by this rebase. I
checked the list against `git log` this time rather than quoting from memory, which is
what put the wrong hashes in the last one.

All of qa25's findings are closed except the two I filed instead of fixing, and all of
qual25's that you ruled on. Twenty-nine mutants that survived a green suite, all dead.

The ones I would want you to read, because each is a claim the PR made that was not true:

- The pager rendered on EVERY open, over an empty pane, with no cursor behind it. Two
  booleans admitted a state that is not a fact. It is one tri-state variable now, and
  dropping the latch was a second fix: a channel whose history fits one page answered
  `nextCursor: null` and the pager never returned when the 51st post arrived.
- The page limit's ceiling was asserted nowhere. Raised from 200 to 2,000,000 AT ITS
  DEFINITION, 201 tests stayed green; `?limit=0`, `?limit=2.5` and an HTTP ceiling 5000x
  the socket's all survived. "Too much data over a websocket" is the regression this repo
  names first and this limit was all of it.
- Seven of the eight error mappings at the two doors had no test, and the socket door had
  no error-path test of any kind. Each mutant now dies to the test for ITS door and no
  other — a socket mutant killed by an HTTP test would mean one door is standing in for
  the other, which is what #20 did.
- Nothing walked a channel. Ignoring the cursor in the FORWARD branch survived while the
  identical mutant in the backward branch was killed, so the asymmetry was in the tests.
  At the door the forward path could not have been served at all: the stub had no
  `listPosts`, which is why hardcoding the handler's direction survived.
- QUAL-25-07, your ruling: one over-fetch function beside the codec. The evidence that it
  is shared rather than moved is that five of six mutants in it die through BOTH suites
  from a single mutation. The sixth is the equality the two copies disagreed on, and no
  door can produce the input that separates them, so it is covered by calling the function
  directly with three rows and a limit of one.

TWO GAPS FILED, NOT FIXED, both with the evidence in the bead:

- `t3_bot-v33` — a schema-refused HTTP request answers 400 with a JSON `null` body. I
  asserted `reason: "invalid_request"` from the contract's own vocabulary and measured
  `null`: a payload-decode refusal is the platform's, so it carries no code, no reason and
  no traceId, unlike every refusal the handler raises itself. A caller cannot tell
  `?limit=201` from any other malformed query. The test asserts the null so that giving
  these refusals a reason REDS the line instead of passing quietly. Closing it means
  touching the door's error plumbing, which is not #25's.
- `t3_bot-t0v` — qa25's TEST-25-08, now with a second instance from my own sweep: a
  different unrelated test in the same shared `it.layer` block ("revalidates hash-like
  static filenames with a missing manifest") came up red in one mutant run. Two instances
  in two different tests makes it a class in that file. Neither verdict was affected, but
  a sweep reporting "killed by 2" with one red being noise makes its next SURVIVOR hard to
  trust. qa25's remedy is for the sweep tool to re-run a candidate kill and discard reds
  that do not reproduce — that is `a4i`/#17, so I will do it there rather than here.

WHAT I AM WAITING ON, and why I am not saying "PR ready" yet:

1. Fork CI on 8a0e58ce9. Four checks pending as I write this; I am watching them.
2. des25 on DES-25-02. The fix is one class on the post body and I have NOT verified it
   in a browser — it is a layout claim and the only honest measurement is
   `scrollWidth` against `clientWidth` at 390px with the long-token bodies. des25
   measured the defect and has the worktree and the fixture, so I sent it back there.
   Its verdict was REVISE/72 with "an approve if DES-25-02 is fixed or consciously
   deferred with a bead", so this is the last thing between the design lane and an
   approve.

I also asked des25 about something that is not mine: at 390px a product toast
("Update Available: Codex v0.154.0", `dropdown-glass`) sat exactly on top of the pager
and blocked a real click until it cleared. Not my bug and not fixed here, but a toast that
covers the only paging control on a phone is worth someone's bead, and des25 is the only
one who has seen it happen.

#17 is untouched since my last report on it: five lanes triaged, API-17-06 and API-17-07
still open, and now the sweep re-run remedy above to add.
