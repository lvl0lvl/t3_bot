/**
 * The pure core, which is the part that has produced wrong answers.
 *
 * Nothing here spawns a process or touches git. The decisions worth pinning are
 * "did the mutation land where I aimed it" and "does this failure mean
 * anything", and both are functions of strings.
 */

import { describe, expect, it } from "vite-plus/test";

import {
  applyMutation,
  confirm,
  duplicateMutationIds,
  exitCodeFor,
  formatReport,
  judge,
  nonNormalMutationPaths,
  readVitestJson,
  statusPaths,
  type Mutation,
  type RunResult,
  unappliableRows,
} from "./guard-sweep.ts";

const mutation = (overrides: Partial<Mutation> = {}): Mutation => ({
  id: "m",
  // A default so the existing tests stay about what they were about. The tests
  // that care about grouping override it — `guard` exists to group rows, so a
  // fixture where every row shares one guard cannot exercise it.
  guard: "requireThing",
  axis: "inert",
  file: "src/thing.ts",
  find: "if (guard) {",
  replace: "if (false) {",
  ...overrides,
});

const run = (failed: ReadonlyArray<string>, total: number): RunResult => ({
  failed: new Set(failed),
  total,
});

describe("applyMutation", () => {
  it("replaces an anchor that occurs exactly once", () => {
    const outcome = applyMutation("a\nif (guard) {\nb\n", mutation());
    expect(outcome._tag).toBe("applied");
    expect(outcome._tag === "applied" ? outcome.source : "").toBe("a\nif (false) {\nb\n");
  });

  it("refuses an anchor that occurs twice, and says how many", () => {
    // THE DEFECT THIS EXISTS FOR. A replace of a non-unique anchor does not
    // fail: it edits the first occurrence, which may be in another function
    // entirely, and the result is a mutation that ran somewhere nobody chose.
    const outcome = applyMutation("if (guard) {\nx\nif (guard) {\n", mutation());
    expect(outcome).toEqual({ _tag: "anchor-not-unique", occurrences: 2 });
  });

  it("refuses an anchor that is a substring of a differently indented line", () => {
    // The concrete shape: a four-space anchor is a substring of the ten-space
    // occurrence of the same code eight lines earlier, so the mutation landed
    // in the wrong function and a presence check confirmed the mutated text
    // was present — the wrong mutated text.
    const source = [
      "          workspaceRoot: config.cwd,",
      "",
      "  yield* seed({",
      "    workspaceRoot: config.cwd,",
    ].join("\n");
    const outcome = applyMutation(
      source,
      mutation({ find: "    workspaceRoot: config.cwd,", replace: "    workspaceRoot: base," }),
    );
    expect(outcome).toEqual({ _tag: "anchor-not-unique", occurrences: 2 });
  });

  it("refuses an absent anchor rather than reporting a survivor", () => {
    expect(applyMutation("nothing like it here", mutation())).toEqual({ _tag: "anchor-absent" });
  });

  it("refuses a replacement identical to its anchor", () => {
    // Otherwise the sweep runs a full suite against unmodified code and calls
    // the green run a survivor.
    expect(applyMutation("if (guard) {", mutation({ replace: "if (guard) {" }))).toEqual({
      _tag: "replace-is-a-no-op",
    });
  });
});

describe("unappliableRows", () => {
  const sources = (source: string) => (file: string) =>
    file === "src/thing.ts" ? source : undefined;

  it("says nothing when every anchor resolves exactly once", () => {
    const rows = unappliableRows({
      mutations: [mutation()],
      moved: new Set(),
      read: sources("a\nif (guard) {\nb\n"),
    });
    expect(rows).toEqual([]);
  });

  it("names the row and the file for an absent anchor", () => {
    const rows = unappliableRows({
      mutations: [mutation({ id: "gone" })],
      moved: new Set(),
      read: sources("a\nsomething else\nb\n"),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("gone");
    expect(rows[0]).toContain("src/thing.ts");
  });

  it("names the COUNT for a non-unique anchor, which is the one a presence check cannot see", () => {
    // A non-unique anchor does not fail — it succeeds somewhere unintended, and every
    // downstream signal is satisfied by the wrong edit. The count is what tells an author
    // which of the two problems they have.
    const rows = unappliableRows({
      mutations: [mutation({ id: "twice" })],
      moved: new Set(),
      read: sources("if (guard) {\nx\nif (guard) {\n"),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("twice");
    expect(rows[0]).toContain("2 times");
  });

  it("refuses a replacement identical to its anchor, which would report a SURVIVOR", () => {
    // The worst of the three: the suite runs against unmodified code and the row is
    // reported as surviving, so a false FINDING rather than an honest absence.
    const rows = unappliableRows({
      mutations: [mutation({ id: "noop", replace: "if (guard) {" })],
      moved: new Set(),
      read: sources("a\nif (guard) {\nb\n"),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("noop");
  });

  it("leaves a row whose file setupCommand wrote to, which the row loop explains better", () => {
    // Its anchor is absent here, so a pre-flight that did not skip it would refuse —
    // and refuse for the wrong reason. `setupCommand` writing a mutation target is not
    // the config's anchor being wrong, and the per-row NOT RUN names the actual cause.
    const rows = unappliableRows({
      mutations: [mutation({ id: "setup-wrote-it" })],
      moved: new Set(["src/thing.ts"]),
      read: sources("a\nsomething else\nb\n"),
    });
    expect(rows).toEqual([]);
  });

  it("leaves a row it could not read, which the row loop tells apart three ways", () => {
    // Untracked, unreadable and outside-the-swept-tree are three different answers the
    // row loop gives by name. One refusal here would collapse them into a vague one.
    const rows = unappliableRows({
      mutations: [mutation({ id: "unreadable", file: "src/absent.ts" })],
      moved: new Set(),
      read: sources("a\nif (guard) {\nb\n"),
    });
    expect(rows).toEqual([]);
  });
});

describe("judge", () => {
  it("credits only tests that were passing at baseline", () => {
    // A suite with environment-dependent failures reports the same COUNT with
    // and without a mutation. Counting them makes a mutant that killed nothing
    // indistinguishable from one that killed something — which is exactly how a
    // mutant on an already-red test read as a kill.
    const baseline = run(["f.ts > flaky"], 10);
    expect(judge(baseline, run(["f.ts > flaky"], 10))).toEqual({ _tag: "survived" });
  });

  it("names the tests that went from passing to failing", () => {
    const baseline = run(["f.ts > flaky"], 10);
    const verdict = judge(baseline, run(["f.ts > flaky", "g.ts > real", "h.ts > also"], 10));
    // Sorted, so the report's order does not depend on Set iteration order.
    expect(verdict).toEqual({
      _tag: "killed",
      by: ["g.ts > real", "h.ts > also"],
      // ONE RUN IS ONE RUN: `judge` cannot know whether these reproduce, so its kills are
      // unconfirmed and only a second run promotes them.
      confirmed: false,
    });
  });

  it("does not treat a baseline failure that went away as a kill", () => {
    // A mutation can make a failing test pass. That is information, but it is
    // not evidence that the mutated line is pinned.
    expect(judge(run(["f.ts > flaky"], 10), run([], 10))).toEqual({ _tag: "survived" });
  });

  it("decides by MEMBERSHIP, not by how many failed", () => {
    // THE FIXTURE THAT SEPARATES THE TWO IMPLEMENTATIONS, and the other three
    // in this describe cannot: each differs in CARDINALITY between baseline and
    // mutant, so `newlyFailing.length === 0` and
    // `mutant.failed.size <= baseline.failed.size` agree on all of them. The
    // count-based version of `judge` passed every one of them — measured — which
    // made refusal 2 ("never infers a kill from a failure COUNT") the one guard
    // in this tool that nothing held.
    //
    // Equal size, disjoint membership: one environment-dependent failure HEALED
    // while the mutation killed a real test. Ordinary rather than contrived —
    // `apps/server` carries 12 such failures, which is the whole reason kills
    // are by name.
    const baseline = run(["f.ts > flaky"], 10);
    const mutant = run(["g.ts > real"], 10);
    expect(baseline.failed.size).toBe(mutant.failed.size);
    expect(judge(baseline, mutant)).toEqual({
      _tag: "killed",
      by: ["g.ts > real"],
      confirmed: false,
    });
  });
});

describe("readVitestJson", () => {
  it("reads failing tests by their full name", () => {
    // SHAPED LIKE THE REPORTER'S OUTPUT, opening key included. A fixture that
    // starts with any other key does not exercise the slice the parser takes,
    // and these two were passing only because an earlier version guessed at the
    // first `{` anywhere in stdout.
    const stdout = JSON.stringify({
      numTotalTestSuites: 1,
      testResults: [
        {
          name: "/repo/a.test.ts",
          assertionResults: [
            { status: "passed", fullName: "suite > ok" },
            { status: "failed", fullName: "suite > broken" },
          ],
        },
      ],
    });
    expect(readVitestJson(stdout)).toEqual({
      failed: new Set(["/repo/a.test.ts > suite > broken"]),
      total: 2,
    });
  });

  it("distinguishes two tests that share a title in different files", () => {
    // A bare title would let a kill in one file be credited to a mutation in
    // another, and the same title in two suites is routine.
    const stdout = JSON.stringify({
      numTotalTestSuites: 2,
      testResults: [
        { name: "/repo/a.test.ts", assertionResults: [{ status: "failed", title: "refuses" }] },
        { name: "/repo/b.test.ts", assertionResults: [{ status: "failed", title: "refuses" }] },
      ],
    });
    expect(readVitestJson(stdout).failed.size).toBe(2);
  });

  it("reads the report past output a test logged before it", () => {
    const report = JSON.stringify({
      numTotalTestSuites: 1,
      testResults: [
        { name: "/repo/a.test.ts", assertionResults: [{ status: "failed", title: "real" }] },
      ],
    });
    const stdout = `a test logged { this\nand also {"looks": "like json"}\n${report}\n`;
    expect(readVitestJson(stdout)).toEqual({
      failed: new Set(["/repo/a.test.ts > real"]),
      total: 1,
    });
  });

  it("reports no tests when a test LOGGED something that parses and no report followed", () => {
    // THE INPUT NO SINGLE PART CAN RESCUE, and it took three tries to find.
    //
    // Finding the report is two independent decisions: anchor on the reporter's
    // own opening key, and refuse output that does not parse. An input where a
    // test merely logs a brace is rescued by EITHER of them, so a mutant that
    // restores the old first-brace fallback survives it — measured, twice, over
    // two careful fixtures of mine. That is exactly the caveat in this file's
    // header, and I walked into it while fixing this function.
    //
    // Here a test logs a JSON object that PARSES, and the reporter never writes
    // one. The parse guard never fires, so only the anchor decides:
    //   - first-brace fallback: the logged object is parsed and its "failure"
    //     becomes the suite's — a FABRICATED measurement, which is worse than
    //     none and is the whole class of defect this tool exists to find.
    //   - anchored on the key: no measurement.
    const logged = JSON.stringify({
      testResults: [
        { name: "/logged/by/a/test.ts", assertionResults: [{ status: "failed", title: "fake" }] },
      ],
    });
    expect(readVitestJson(`a test printed its own report:\n${logged}\n`)).toEqual({
      failed: new Set(),
      total: 0,
    });
  });

  it("reports no tests rather than no failures when the report is truncated", () => {
    // A run killed mid-write leaves the opening key and nothing that parses.
    // NO MEASUREMENT, not a green run: an empty failure set here would make
    // every mutation under it "survive" unanimously.
    expect(readVitestJson('{"numTotalTestSuites":1,"testResults":[{"name":"/repo/a')).toEqual({
      failed: new Set(),
      total: 0,
    });
  });

  it("reports no tests rather than no failures when there is no JSON", () => {
    // A suite that failed to load has an empty failure set, which is not a
    // green run. `total: 0` is the caller's signal that nothing was measured.
    expect(readVitestJson("Error: cannot find module\n")).toEqual({
      failed: new Set(),
      total: 0,
    });
  });
});

describe("formatReport", () => {
  it("keeps survivors and not-runs apart", () => {
    // They look identical in a count and mean opposite things: a survivor is a
    // measurement, a not-run is the absence of one.
    const report = formatReport(run([], 26), [
      { mutation: mutation({ id: "unpinned" }), verdict: { _tag: "survived" } },
      {
        mutation: mutation({ id: "misaimed" }),
        verdict: { _tag: "not-run", reason: "anchor occurs 2 times" },
      },
    ]);
    expect(report).toContain("1 survivor: unpinned");
    expect(report).toContain("1 NOT RUN: misaimed");
    expect(report).toContain("These are not survivors — no measurement was taken.");
  });

  it("names the guard asked on the inert axis only", () => {
    const report = formatReport(run([], 26), [
      {
        mutation: mutation({ id: "i", guard: "requireThing", axis: "inert" }),
        verdict: { _tag: "killed", by: ["a > b"], confirmed: true },
      },
    ]);
    expect(report).toContain("Measured on the `inert` axis only: requireThing");
  });

  it("names the guard asked on the wider axis only", () => {
    // The mirror, and it needs its own fixture: a notice that only ever reported
    // the inert-only case would pass the test above and say nothing about a guard
    // whose exclude side was never asked.
    const report = formatReport(run([], 26), [
      {
        mutation: mutation({ id: "w", guard: "requireShape", axis: "wider" }),
        verdict: { _tag: "killed", by: ["a > c"], confirmed: true },
      },
    ]);
    expect(report).toContain("Measured on the `wider` axis only: requireShape");
  });

  it("stays quiet about a guard measured on BOTH axes", () => {
    const report = formatReport(run([], 26), [
      {
        mutation: mutation({ id: "i", guard: "requireThing", axis: "inert" }),
        verdict: { _tag: "killed", by: ["a > b"], confirmed: true },
      },
      {
        mutation: mutation({ id: "w", guard: "requireThing", axis: "wider" }),
        verdict: { _tag: "killed", by: ["a > c"], confirmed: true },
      },
    ]);
    expect(report).not.toContain("axis only");
  });

  it("reports a single-axis guard even when ANOTHER guard covered both", () => {
    // THE FIXTURE THE OLD NOTICE COULD NOT SEE, and the reason this is per-guard.
    // The notice used to fire only when NO row anywhere was `wider`, so one
    // `wider` row silenced it for every guard in the file — and the previous test
    // for it, "stays quiet about the axis when both are present", asserted
    // exactly that bug.
    //
    // The checked-in config is this shape: ten rows over seven guards, three
    // measured on both axes and four on one, so the report said both axes had
    // been asked when four guards had one.
    const report = formatReport(run([], 26), [
      {
        mutation: mutation({ id: "both-i", guard: "requireCovered", axis: "inert" }),
        verdict: { _tag: "killed", by: ["a > b"], confirmed: true },
      },
      {
        mutation: mutation({ id: "both-w", guard: "requireCovered", axis: "wider" }),
        verdict: { _tag: "killed", by: ["a > c"], confirmed: true },
      },
      {
        mutation: mutation({ id: "half", guard: "requireHalf", axis: "inert" }),
        verdict: { _tag: "killed", by: ["a > d"], confirmed: true },
      },
    ]);
    // ASSERTED ON THE NOTICE LINE, not on the whole report. My first attempt used
    // `expect(report).not.toContain("requireCovered")` and failed — correctly:
    // the table now has a `guard` column, so every guard's name appears in the
    // report whatever the notice says. The claim is about the notice.
    const notice = report
      .split("\n")
      .find((line) => line.startsWith("Measured on the `inert` axis only:"));
    expect(notice).toBe(
      "Measured on the `inert` axis only: requireHalf. Each was asked what it EXCLUDES; a guard that already excludes too much survives that untouched.",
    );
  });

  it("warns that baseline failures cannot be evidence", () => {
    const report = formatReport(run(["f.ts > flaky"], 26), [
      { mutation: mutation(), verdict: { _tag: "survived" } },
    ]);
    expect(report).toContain("already failing and cannot be evidence");
  });
});

describe("exitCodeFor", () => {
  const killed = (id: string) =>
    ({
      mutation: mutation({ id }),
      verdict: { _tag: "killed", by: ["f.ts > real"], confirmed: true },
    }) as const;
  const survived = (id: string) =>
    ({ mutation: mutation({ id }), verdict: { _tag: "survived" } }) as const;
  const notRun = (id: string) =>
    ({
      mutation: mutation({ id }),
      verdict: { _tag: "not-run", reason: "anchor not found" },
    }) as const;

  it("is 0 only when everything was measured and everything died", () => {
    expect(exitCodeFor([killed("a"), killed("b")])).toBe(0);
  });

  it("is 2 for a survivor", () => {
    // A survivor is a MEASUREMENT — an unpinned guard, a finding to act on.
    expect(exitCodeFor([killed("a"), survived("b")])).toBe(2);
  });

  it("is 3 when something was not measured at all", () => {
    expect(exitCodeFor([killed("a"), notRun("b")])).toBe(3);
  });

  it("is 3 rather than 2 when BOTH a survivor and a not-run are present", () => {
    // THE FIXTURE THAT SEPARATES THE TWO ORDERINGS, and the three above cannot:
    // each holds at most one of the two conditions, so checking survivors first
    // and checking not-runs first agree on all of them.
    //
    // NOT RUN has to win. It is the ABSENCE of a measurement, and it undermines
    // the rest of the run — every `find` is a quotation of a file the config does
    // not own, so once one anchor is stale the others are quoting the same moving
    // target and the survivor list can no longer be read as complete. Reporting 2
    // here would say "one unpinned guard, otherwise fine" about a sweep that does
    // not know what it missed.
    expect(exitCodeFor([survived("a"), notRun("b")])).toBe(3);
  });

  it("is 0 for an empty sweep, which the config schema already refuses", () => {
    // Reachable only by calling this directly: `SweepConfig` requires at least
    // one mutation. Stated rather than left to be discovered, since 0 here means
    // "nothing survived" and not "nothing was asked".
    expect(exitCodeFor([])).toBe(0);
  });
});

describe("confirm", () => {
  // `t3_bot-t0v`: `server.test.ts` holds order- or timing-dependent tests. An
  // unrelated OTLP-export test reddened in ONE run of a mutation touching only the
  // channel-posts HTTP door and stayed green in four re-runs, and a static-filename
  // test did the same under a different mutation. A kill's reds have to reproduce.
  it("drops a red the second run did not reproduce", () => {
    // THE FIXTURE THAT SEPARATES THE TWO IMPLEMENTATIONS: the two runs must DISAGREE.
    // Every case where they agree is satisfied by returning the verdict untouched, so
    // a fixture with matching runs measures nothing about this function.
    const baseline = run([], 10);
    const first = judge(baseline, run(["g.ts > real", "flaky.ts > unstable"], 10));
    const verdict = confirm(first, { second: run(["g.ts > real"], 10), baseline });
    expect(verdict).toEqual({ _tag: "killed", by: ["g.ts > real"], confirmed: true });
  });

  it("calls it a SURVIVOR when every red was noise", () => {
    // The safe direction: an unpinned guard reported for someone to look at, rather
    // than a mutation quietly credited with a kill it did not earn.
    const baseline = run([], 10);
    const first = judge(baseline, run(["flaky.ts > unstable"], 10));
    expect(confirm(first, { second: run([], 10), baseline })).toEqual({
      _tag: "survived",
      // CARRYING WHAT IT LOST, so the report can say this row reddened once and not again
      // rather than filing it with the rows nothing ever depended on.
      reds: ["flaky.ts > unstable"],
    });
  });

  it("keeps a kill whose reds both reproduced", () => {
    const baseline = run([], 10);
    const first = judge(baseline, run(["g.ts > real", "h.ts > also"], 10));
    expect(confirm(first, { second: run(["g.ts > real", "h.ts > also"], 10), baseline })).toEqual({
      _tag: "killed",
      by: ["g.ts > real", "h.ts > also"],
      // THE ONLY CASE THAT EARNS `true`: both reds appeared in two runs with the same
      // mutation applied.
      confirmed: true,
    });
  });

  it("leaves the verdict alone when the confirming run did not collect", () => {
    // A second run that measured less than the baseline says nothing about the reds,
    // and reading it as "they did not reproduce" would turn every real kill under a
    // flaky COLLECTION into a survivor — the same unmeasured-as-evidence mistake the
    // baseline guard exists for, arrived at from the other side.
    const baseline = run([], 10);
    const first = judge(baseline, run(["g.ts > real"], 10));
    // UNCONFIRMED rather than confirmed: the verdict stands because an uncollected run is
    // no evidence either way, and the report has to be able to say nobody looked.
    expect(confirm(first, { second: run([], 0), baseline })).toEqual({
      _tag: "killed",
      by: ["g.ts > real"],
      confirmed: false,
    });
    expect(confirm(first, { second: run([], 4), baseline })).toEqual({
      _tag: "killed",
      by: ["g.ts > real"],
      confirmed: false,
    });
  });

  it("does not re-judge a survivor or a not-run", () => {
    // Only a candidate KILL is re-run, because a flaky red can turn a survivor into a
    // kill and never the reverse. Nothing calls this with a second run for the others,
    // and if something did it must not invent a verdict for them.
    const baseline = run([], 10);
    expect(confirm({ _tag: "survived" }, { second: run(["g.ts > real"], 10), baseline })).toEqual({
      _tag: "survived",
    });
    const notRun = { _tag: "not-run", reason: "anchor absent" } as const;
    expect(confirm(notRun, { second: run(["g.ts > real"], 10), baseline })).toEqual(notRun);
  });
});

describe("duplicateMutationIds", () => {
  it("names an id two rows share", () => {
    // `id` is the report's ONLY row identity — the table's second column, the survivor
    // list, the NOT RUN list and every kill heading. Two rows sharing one produce a
    // summary naming a row that also appears as a kill, and a reader cannot tell which
    // of the two survived.
    expect(duplicateMutationIds([{ id: "a" }, { id: "b" }, { id: "a" }])).toEqual(["a"]);
  });

  it("is empty when every id is distinct", () => {
    expect(duplicateMutationIds([{ id: "a" }, { id: "b" }])).toEqual([]);
  });

  it("names each repeated id ONCE, sorted, however many times it repeats", () => {
    // Three rows sharing an id is one problem, not two, and the message is read by a
    // person fixing a config.
    expect(
      duplicateMutationIds([{ id: "z" }, { id: "z" }, { id: "z" }, { id: "a" }, { id: "a" }]),
    ).toEqual(["a", "z"]);
  });
});

describe("nonNormalMutationPaths", () => {
  const row = (id: string, file: string) => ({ id, file });

  it("names a row whose path git would print without the `./`", () => {
    // The spelling that caused the false kill. `git status --porcelain` prints
    // `src/thing.ts`, so a row spelled `./src/thing.ts` matches no keyed check here.
    expect(nonNormalMutationPaths([row("a", "./src/thing.ts")])).toEqual([
      { id: "a", file: "./src/thing.ts" },
    ]);
  });

  it("names a `..` segment anywhere in the path, and an absolute path", () => {
    expect(
      nonNormalMutationPaths([
        row("dotdot-inside", "src/../src/thing.ts"),
        row("dotdot-leading", "../sibling/thing.ts"),
        row("absolute", "/etc/passwd"),
      ]).map((offender) => offender.id),
    ).toEqual(["dotdot-inside", "dotdot-leading", "absolute"]);
  });

  it("ADMITS a dotfile path, which is what separates this from a leading-dot check", () => {
    // `.github/workflows/ci.yml` is a real mutation target — a check keyed on "starts with a
    // dot" refuses a config nobody could then write, and the two readings agree on every
    // other input. This is the test that distinguishes them.
    expect(
      nonNormalMutationPaths([
        row("workflow", ".github/workflows/ci.yml"),
        row("hidden-file", "src/.hidden.ts"),
        row("hidden-dir", "src/.cache/thing.ts"),
        row("dots-in-name", "src/..thing.ts"),
        row("plain", "src/thing.ts"),
      ]),
    ).toEqual([]);
  });

  it("names a path that is only dots, and the empty path", () => {
    // `.` and `..` reach `path.join(root, file)` as the repo root and its parent, and the
    // empty string reaches it as the root itself — none of them is a file to mutate.
    expect(
      nonNormalMutationPaths([row("dot", "."), row("dotdot", ".."), row("empty", "")]).map(
        (offender) => offender.id,
      ),
    ).toEqual(["dot", "dotdot", "empty"]);
  });

  it("names only the offending rows, in config order, carrying each row's own spelling", () => {
    // The refusal is read by someone editing a config: a message that names a row which is
    // fine costs them an edit, and one that drops a row costs them a second run.
    expect(
      nonNormalMutationPaths([
        row("fine-first", "src/a.ts"),
        row("bad-second", "./src/b.ts"),
        row("fine-third", "src/c.ts"),
        row("bad-fourth", "src/../src/d.ts"),
      ]),
    ).toEqual([
      { id: "bad-second", file: "./src/b.ts" },
      { id: "bad-fourth", file: "src/../src/d.ts" },
    ]);
  });
});

describe("statusPaths", () => {
  it("reads the path out of a porcelain line", () => {
    expect([...statusPaths(" M src/a.ts\n?? src/b.ts\n")]).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("takes the NEW name of a rename", () => {
    // `R  old -> new` is the form a hand-written parser gets wrong, and the new name is the
    // one a mutation could target — a mutation aimed at the old name cannot resolve at all.
    expect([...statusPaths("R  src/old.ts -> src/new.ts\n")]).toEqual(["src/new.ts"]);
  });

  it("is empty for a clean tree", () => {
    // The `--in-place` path relies on this: the handler has already refused a dirty tree, so
    // every row must pass the moved-target check rather than be refused by an empty string.
    expect([...statusPaths("")]).toEqual([]);
    expect([...statusPaths("\n")]).toEqual([]);
  });
});

describe("the report's three kinds of not-a-plain-kill", () => {
  const row = (id: string, verdict: Parameters<typeof formatReport>[1][number]["verdict"]) => ({
    mutation: mutation({ id }),
    verdict,
  });
  const baseline: RunResult = { failed: new Set<string>(), total: 10 };

  it("keeps a demoted kill out of the inert survivors' sentence", () => {
    // `API-17-15`. "Nothing in this suite depends on those lines" is true of an inert guard
    // and FALSE of a row that reddened once and not again — that row is a flaky test or a
    // flaky kill and it is the one most needing a human, so it must not be filed with the
    // rows needing none.
    const report = formatReport(baseline, [
      row("inert", { _tag: "survived" }),
      row("flaky", { _tag: "survived", reds: ["f.ts > sometimes"] }),
    ]);
    expect(report).toContain("1 survivor: inert. Nothing in this suite depends on those lines.");
    expect(report).toContain("1 NO RED REPRODUCED: flaky");
    // And the demoted row is NOT named in the inert sentence.
    expect(report).not.toContain("inert, flaky");
  });

  it("says when a kill's reds were never confirmed", () => {
    // Printed identically to a confirmed kill before this, so a row whose only red was noise
    // read as a kill whenever the second run happened to under-collect.
    const report = formatReport(baseline, [
      row("solid", { _tag: "killed", by: ["f.ts > real"], confirmed: true }),
      row("unchecked", { _tag: "killed", by: ["f.ts > real"], confirmed: false }),
    ]);
    expect(report).toContain("1 KILLED BUT UNCONFIRMED: unchecked");
    expect(report).not.toContain("solid, unchecked");
  });
});

describe("exitCodeFor, with confirmation", () => {
  const killed = (id: string, confirmed: boolean) =>
    ({
      mutation: mutation({ id }),
      verdict: { _tag: "killed", by: ["f.ts > real"], confirmed },
    }) as const;

  it("is 3 for an unconfirmed kill, not 0", () => {
    // An unconfirmed kill is an ABSENT measurement and 3 is already the code for one.
    // Exiting 0 here would say "every mutation measured, every one killed" over a row nobody
    // checked — which is the sentence this tool exists to stop.
    expect(exitCodeFor([killed("a", true), killed("b", false)])).toBe(3);
  });

  it("is still 0 when every kill was confirmed", () => {
    expect(exitCodeFor([killed("a", true), killed("b", true)])).toBe(0);
  });

  it("is 3 rather than 2 when a demoted survivor sits beside an unconfirmed kill", () => {
    // Both are absences; neither is the survivor finding that 2 reports.
    expect(
      exitCodeFor([
        killed("a", false),
        { mutation: mutation({ id: "b" }), verdict: { _tag: "survived", reds: ["x"] } },
      ]),
    ).toBe(3);
  });
});
