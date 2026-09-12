FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-p4u · PR #30 READY TO MERGE at ba12cdfaa · CI green by SHA, count gate exit 0, sweep exit 2 baseline 691 with only 7rj's row surviving and ami's now killed, mutant table re-measured twice on the rewritten test, body's gate section generated from the logs · no beads commit per ruling 1 · contracts lane closed out: absent-optional answered for every caller and the compiler would NOT catch ofl's narrowing, which is now on that bead · 7rj sweep re-running, PR opens when it reports · 1ez+s4l pushed at 48f9f4bb5
AT: 2026-09-12 18:09 EDT

**#30 is ready to merge at `ba12cdfaa`.** All three instruments on that exact head, and the body's gate
section is generated from their logs rather than retyped — I have transcribed a figure wrong twice today,
so the table, the baseline and the exit codes are read out of the run's own output and the script refuses
if a log is missing a line.

- **Fork CI: green by SHA.** `Fork Check` + `Fork Test Server 1/2/3`, 4 completed, `not-success: 0`.
- **Count gate: exit 0.** `OrchestrationEngine.test.ts` 36 -> 37, no test lost by count or by name. The
  exit 1 on the previous head was the stale base, now `t3_bot-1tv`.
- **Guard sweep: exit 2**, baseline **691** tests / 0 already failing, nothing NOT RUN, **one survivor**:
  `issuer-required-fails-open`, which is `t3_bot-7rj` and is fixed on its own branch.
  `author-membership-matches-id-only` reads **killed** here, which is the rebase doing what hist30 said
  it would.
- **`vpr typecheck` exit 0**, zero `error TS`. 703 tests green across
  `apps/server/src/orchestration` + `serverRuntimeStartup.test.ts`.
- **The mutant table re-measured on the rewritten test file, twice, agreeing exactly** — six rows, all
  killed. The gate prints its own caveat that it cannot see a test rewritten under the same name, and
  this round rewrote four things inside that test, so carrying the old table forward would have been the
  exact mistake it warns about.

The diff is four source files. No beads commit, per your ruling 1.

**The contracts lane finished its answers and two of them are worth reading even though all three are
"no finding".**

It answered the absent-optional question for **every caller** rather than for my input, then executed it
independently of the bug lane and agreed: every field but `type`/`commandId`/`threadId` is
`Schema.optional`, the event payload likewise, and four layers gate on `!== undefined` and write nothing
otherwise — decider, in-memory projector, persistence projector — none of them in a caller-specific
branch. So absent means preserve and an explicit `null` is the only clear, identically for web, mobile,
the reactors and the seeder; `title` and `modelSelection` are not nullable and cannot be cleared at all.

It also answered the question I did not think to ask: whether the projection row can satisfy the
command's schema at all. It can, **structurally** —
`OrchestrationThread.modelSelection` and `ThreadMetaUpdateCommand.modelSelection` are the same schema
object, so the row is produced by decoding through the schema the command accepts. It executed the
assumption underneath that (decode STRIPS an undeclared key: probe input carried `surprise: {nested: 1}`,
decoded keys were exactly instanceId/model/options) and the one shape a spread could get wrong (`options`
is `optionalKey`; a row without it and an `options: undefined` input both decode to the key being
ABSENT, which is what the spread reproduces).

**The sharpest thing it said is now on `t3_bot-ofl` rather than in a PR body: the compiler would not
catch the narrowing.** A shell row missing `options` is still assignable where `ModelSelection` is
wanted, as long as it carries `instanceId` and `model` — so narrowing that read would not fail CI, it
would silently drop operator-set options on exactly the environments the repair exists for. That bead's
acceptance now requires the narrower row type to declare the same `ModelSelection`, and #30's engine
test already asserts `options` survives the repair, so a narrowing that drops them reds rather than
ships.

On `ProviderInstanceId`, also executed: `make` validates and never normalizes, and it cannot reject in
this call because `ProviderDriverKind` and `ProviderInstanceId` are the same slug schema branded twice.
The registry hydration registers each built-in under `defaultInstanceIdForDriver(driverKind)`, which is
why `claudeAgent` resolves with no settings entry — so the repair moves a thread ONTO that invariant
rather than perturbing it — and the client suppresses the instance label when it equals the default, so a
repaired thread renders identically to a freshly seeded one.

**7rj:** its sweep is re-running on `82529198f` now. PR opens the moment it reports, which is also what
starts its CI.

**1ez + s4l:** branch `boss1/t3_bot-1ez-member-ref-unique` at `48f9f4bb5`, pushed, both beads claimed.
One invariant closes both — `(memberKind, memberId)` unique per channel, in the loop that already walks
the roster — with the function renamed so a caller left behind is a compile error rather than a guard
wired at one of two sites. 766 tests green across orchestration and the comms toolkit. Owed before that
PR: the mutation prover (both axes, plus the `find`/`findLast` row I expect to SURVIVE by design, because
with one row per ref no roster a command can build distinguishes them) and a typecheck.

Three things it found worth your eye when it comes up: the routing test caught the one consequence I had
not predicted, on the first run, by name — its `member.add` probe was adding a fresh handle for the
seeded member's id, and its `uncoveredChannels` assertion exists exactly so a probe that starts being
refused cannot drop out of the router/decider comparison in silence. The sweep config's
`handles-unique-inert` row needed its anchor repaired, because my rewrite renamed the set it named and
the row would have reported NOT RUN — exit 3, outranking a survivor. And `t3_bot-z7u` records the p4u
shape this invariant creates: a roster written before it that holds a duplicated ref would refuse every
later `member.add` with an error naming a member the operator did not mention.
