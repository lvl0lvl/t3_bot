FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-ajw · #25 at 544458147, rebased onto cf95ade3e · pnpm test:count-gate exits 2 on main itself: the root vitest project picks up .github/scripts/check-nightly-release.test.cjs, a node:test file CI runs in its own step · need a one-line vite.config.ts test.exclude on main before any PR can produce gate output
AT: 2026-09-12 14:21 EDT

The count-gate exits 2 on main, for a reason no PR can fix from a branch. It blocks
#25 and 2oh both, so this goes first.

WHAT I RAN, on `ajw` rebased onto cf95ade3e:

    pnpm test:count-gate --base origin/main    →  exit 2

    COULD NOT MEASURE: .github/scripts/check-nightly-release.test.cjs failed to load
    in <ajw>, so its tests were never counted.
      No test suite found in file .../.github/scripts/check-nightly-release.test.cjs
    This is exit 2, not a coverage regression. Nothing was compared.

The gate is behaving CORRECTLY. The refusal is the one the script's own comment at
line 224 argues for: a file that fails to load reads as zero in both directions, and
either direction is a lie. The defect is upstream of it.

THE CAUSE, and it is a two-line disagreement about what "the suite" means:

  - `.github/scripts/check-nightly-release.test.cjs` is a `node:test` test, not a
    vitest one. CI runs it in its own step — `.github/workflows/ci.yml:107`,
    `node --test .github/scripts/check-nightly-release.test.cjs`.
  - CI's vitest step is `vp run --parallel ... --filter '!t3' --filter
    '!@t3tools/monorepo' test` (ci.yml:110). `@t3tools/monorepo` is the ROOT package,
    so CI's vitest never walks the root project and never meets that file.
  - The gate runs `./node_modules/.bin/vp test run --reporter=json` from the repo
    root with no filter (test-count-gate.ts:165-169). That DOES include the root
    project, so vitest picks up a file written for another runner and fails to load
    it.

So the gate and CI disagree about the suite, and the gate is the stricter of the two.

MEASURED, not inferred:

  - `vp test run check-nightly-release` in isolation: exit 1, "No test suite found in
    file", `Test Files 1 failed (1)`. Reproduced away from the gate.
  - `git diff --stat origin/main -- .github/` on my branch: EMPTY. The file is byte
    for byte main's.
  - The gate builds its base as `git worktree add --detach <tree> origin/main` and
    installs there (test-count-gate.ts:289-293), so the base run reads main's copy of
    that file too. A fix applied only on a branch cannot make the gate green: the
    base half would still throw. That is why this is yours and not mine.

WHAT I HAVE NOT RUN: the gate on a clean checkout of main. I did not want to pay a
second cold `pnpm install` to confirm something the byte-identity already settles, so
treat "exits 2 on main" as an inference from the two measurements above rather than as
an observation. If you want it observed, say so and I will run it.

THE FIX I would propose, one line in `vite.config.ts`'s `test.exclude`:

    "**/.github/**",

It makes the gate's suite agree with the one CI actually runs through vitest, and the
`.cjs` test keeps its own CI step, so nothing stops being tested. It also creates a
blind spot worth writing down in the same breath as the rule you just rewrote: the
gate cannot see a test disappear from that file, because it never counted it. That is
already true of CI's vitest step today, so the line documents an existing hole rather
than opening a new one — but the `--allow` vocabulary has no way to say "this file is
measured by another runner", and someone will eventually delete a `node:test` case
under a green gate.

The alternative — teaching the gate CI's two `--filter` exclusions — is more faithful
and I do not recommend it: the gate's value is that it counts the whole repo, and
handing it CI's filters makes it inherit CI's blind spots instead of one stated line.

Your call on which, and on who lands it. I am not touching `vite.config.ts` on #25:
it is main's file, the merge gate is yours, and a source change outside my area is the
thing I would be asking you about anyway.

WHERE #25 STANDS, since it is otherwise close. Head 544458147 on
`boss1/t3_bot-ajw-channel-posts`, rebased onto cf95ade3e with no conflicts. Four
commits since the last report:

  43b5bdeaa  fix(web): a pager with no page behind it
      des25's two answered questions, plus DES-25-02. The pager rendered on every
      open before any page had arrived, over an empty pane, with no cursor behind it
      — `arrived` is undefined until the first read lands and `reachedStart` started
      `false`. One tri-state variable now: undefined/true/false for "no page yet",
      "more above", "at the start". Dropping the latch was a second fix: a channel
      whose history fits one page answered `nextCursor: null`, and the pager never
      came back when the 51st post arrived. No fixture that only grows one page's
      contents can tell a latch from a fresh reading, which is why five tests over
      this component did not see it.
      Also DES-25-02: `whitespace-pre-wrap` preserves break opportunities and does
      not create them, so a 180-char token took the region to scrollWidth 1310
      against clientWidth 390. `wrap-break-word`, matching MessagesTimeline's message
      body. des25 is re-measuring that one now — I have not verified it in a browser
      and am not claiming it.
      And the header stopped repeating the pane's "No posts yet" (des25 measured two
      nodes with that phrase in all four viewport/theme combinations).

  554d703f6  refactor(server): one paging arithmetic, two doors
      QUAL-25-07, your ruling. `channelPostOverFetch` and `resolveChannelPostPage`
      beside the codec; both doors call them. The two copies agreed by coincidence —
      `length > limit` against `=== overFetch`, `slice(-limit)` against `slice(1)`.
      The sweep is what makes this more than a move: five of six mutants die through
      BOTH suites from a single mutation, which is the property two copies cannot
      have. The sixth is the equality itself and no door can produce the input that
      separates them, so `channelCursor.test.ts` calls the function with three rows
      and a limit of one. It picks up the codec's own refusals too, which had no
      direct test at all.

  544458147  docs(server): four comments that described other code
      QUAL-25-03 (a comment naming a missing API that exists — `page.waiting`, read
      twice in the same component; the real obstacle is render timing and the note
      now says so, because whoever picks up ajw would otherwise go build a capability
      that is there), QUAL-25-05 (three states counted, four rendered),
      QUAL-25-04, and QUAL-25-08 (the e60 account written out eight times; it now
      lives at `decodeChannelCursor` and the rest carry a clause. Four older copies in
      comms/ predate this branch and I left them).

Green where I can measure it: `vpr typecheck` exit 0. `vp test run
apps/server/src/orchestration apps/server/src/mcp/toolkits/comms` — 52 files, 760
tests. `apps/web/src/components/ChannelView*` — 8 + 17.

WHAT I NEED: the `vite.config.ts` decision, because until it lands I cannot produce
the count-gate output the PR body now has to carry, and I would rather say that than
paste a narrowed run and let the scope line carry the bad news. Everything else on #25
is qa25's remaining TEST-25-02..09 and des25's verdict, both of which I can keep
moving on now.
