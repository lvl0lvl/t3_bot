FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-p4u · PR #30 READY (head 6a6c7b805, 4 lanes, 2 MUST FIX fixed and proven, count gate exit 0, sweep exit 2 with only 7rj's row surviving, CI green by SHA) · t3_bot-7rj · DONE on its own branch, guard sweep exits 0 for the first time, no PR yet per your queue order · need: merge #30, then say go on 7rj; plus two rulings — bd exports to the MAIN checkout so beads created in a worktree are invisible to branches pushed from it (bit #29, nearly bit #30), and hist29's CLAUDE.md bullet on measuring universals, which is your file to change
AT: 2026-09-12 17:46 EDT

**#30 is ready, and 7rj is done behind it.**

## #30 — head `6a6c7b805`, rebased onto `7f1996566`

Four lanes: bug, test-coverage, history, contracts. Two MUST FIX, both of them fixtures that could
not see what they claimed, both now proven dead.

**The fixture imported the constant the guard turns on.** `SHIPPED_BAD_INSTANCE_ID` fed the guard AND
the replayed create, so both sides of the comparison moved together: change it to a value no database
ever held and 53 tests stay green with the repair firing on nothing — the shipped defect restored under
a green suite. QA and contracts measured it independently. My own comment on that export argued the
protection ran the other way. It does not: a test that writes the literal kills that mutant, one that
imports the constant survives it.

**No fixture carried `options`**, so replacing the spread with `{ instanceId, model }` — what a
reviewer asks for instead of a spread — passed while discarding operator-set provider options on the
upgrade boot.

Both fixed. Also: the fresh-seed stub skipped the repair by the wrong branch and passed with the
old-value guard deleted; both receipt comparisons used a string a re-decide can rewrite unchanged; and
four comments were wrong rather than thin, including the replay fixture's justification, where QA built
the counterfactual and both fixtures go red on the identical error.

The question I flagged as unproven is **clean, executed**: a `thread.meta.update` carrying only
`modelSelection` cleared none of `title`, `branch`, `worktreePath` or the linked PR, against a real
database with all four set.

### Gates

- **`TEST_COUNT_GATE_TARGET=apps/server pnpm test:count-gate --base origin/main` — exit 0.**
  `OrchestrationEngine.test.ts` 36 → 37, no test lost by count or by name.
- **`node scripts/guard-sweep.ts --config …channel-invariants.json` — exit 2**, baseline 687 / 0
  already failing, nothing NOT RUN. **One survivor**, `issuer-required-fails-open`, which is 7rj's and
  fixed on its own branch. `author-membership-matches-id-only` is **killed** here now — the rebase did
  what hist30 predicted, and the old body's "#29 has not merged" paragraph is gone rather than left
  standing.
- **Fork CI green by SHA** on `abbf80dd9` (4 checks, 0 not-success); re-running on `6a6c7b805`, which
  adds only the beads manifest.
- **`vpr typecheck` exit 0**, zero `error TS`. 703 tests green across
  `apps/server/src/orchestration` + `serverRuntimeStartup.test.ts`.
- **The whole mutant table re-measured on the rewritten test file, twice, agreeing exactly** — six
  rows, all killed. The count gate prints its own caveat that it cannot see a test rewritten under the
  same name, and this round rewrote four things inside that test, so carrying the old table forward
  would have been the exact mistake it warns about. Dropping the old-value guard now reds **two** files
  instead of one, which is the stub fix paying for itself.

Four findings recorded rather than fixed, each with its measurement: **`gn4`** the seed phase runs
after `reactors.start`, so a draining mention-wake can read the row before the repair lands and consume
one post unanswered on the repair boot — the fix is moving a startup phase, which nothing in the suite
can demonstrate and neither the lane nor I could execute, so it is not going in this PR;
**`ofl`** the whole-read-model load for three instance ids; **`40z`** whether a deleted thread outranks
a re-pointed one, where two lanes read the same measurement opposite ways; **`0fx`** the condition for
deleting the loop, since a migration would have retired itself by number and this will not.

## 7rj — branch pushed, no PR, waiting on your queue order

`requireCommandIssuer`'s fail-closed property was asserted in a docstring and measured by nothing: the
test that walks every channel command with no issuer recorded `exit._tag === "Failure"`, and `Failure`
is true of a **defect** as well as a typed failure. Measured before changing anything — under the
mutation the guard succeeds with `undefined`, the next guard dereferences it, and all seven commands
come back `{"_tag":"Die"}`. A null dereference counted as a refusal. The test now requires the typed
error and its message per command type.

**`guard-sweep` — exit 0, all ten rows killed, baseline 686 / 0 failing, nothing NOT RUN. The first
time the channel-invariants sweep has exited 0.** `issuer-required-fails-open` is killed by "refuses
every channel command that arrives without an issuer", by name — the test that used to pass under it.
Branch `boss1/t3_bot-7rj-issuer-fail-closed` at `cbf0d53c8`, rebased onto current main, body drafted.
Say the word and I open it.

## A workflow defect worth your ruling, because it has now bitten twice

hist29 found that #29's body named `t3_bot-7iw` as a deferral's home while
`git grep 7iw <head> -- .beads/issues.jsonl` returned nothing. I have measured the cause: **`bd`'s
export target is the MAIN checkout's `.beads/issues.jsonl`, not the worktree's.** So every bead any of
us creates while working in a worktree is invisible to every branch pushed from that worktree —
`bd sync --flush-only` in the worktree reports success and changes nothing there. That is why the
`build(beads):` commits all land on main from your checkout.

#30 would have repeated it: four code comments cite gn4, ofl, 40z and 0fx. I moved exactly those ids
into p4u's manifest, line by line — a first attempt that round-tripped the file through a JSON writer
reformatted 29 untouched beads, which is churn you would have had to merge.

Worth a standing rule, your call which: either seniors sync cited beads into the branch before
declaring ready, or PR bodies and code comments may only cite beads you have already flushed on main.

## hist29's answer to the question I asked it, which I want to adopt

I asked for the cheapest check that would have caught all three of the false claims that lane found on
#29. Its answer is better than the question deserved: **all three were already written down, and all
three were in the same place — the bead's NOTES, not its DESCRIPTION.** Criterion 4's answer is in
46h's notes; "every fixture differs in both fields" I quoted from 46h's description, which the notes
had superseded; the three-file table is in the notes and was already stale. `bd show` prints the
description first, so I read the oldest text in the bead and quoted it as present tense three times.

Its proposed CLAUDE.md bullet, for the Tests section — **your file, your call, I have not touched it**:

> - **A universal or a reachability claim is measured, not remembered.** "Every fixture in the repo…"
>   and "no command can produce this" are the two shapes that have been wrong every time: `git grep`
>   the subject before writing the universal, and read the NOTES and acceptance criteria of every bead
>   in the chain before writing the reachability claim. A bead's description is its oldest text and its
>   notes are its newest — three claims in one day were the description quoted as present tense. Cite
>   the field or the SHA you read it from, so the next author can check the same place.

I would add one clause from today: the same rule catches an inverted *protection* claim. "Exporting
this constant means a test cannot silently disarm it" was the fourth false claim, and one `git grep` of
the constant would have shown the fixture importing it.

hist29 also asks for `1ez → 46h`, `s4l → 46h` and `7iw → 46h` dep edges and a re-scope of 46h from
"create the first colliding fixture" to "collapse seven into one", since seven colliding sites now
exist and `bd ready` currently surfaces four overlapping fixture tasks as independent work. That is
your manifest to reshape; I have not added the edges.
