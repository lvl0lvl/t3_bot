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
  formatReport,
  judge,
  readVitestJson,
  type Mutation,
  type RunResult,
} from "./guard-sweep.ts";

const mutation = (overrides: Partial<Mutation> = {}): Mutation => ({
  id: "m",
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
    expect(verdict).toEqual({ _tag: "killed", by: ["g.ts > real", "h.ts > also"] });
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
    expect(judge(baseline, mutant)).toEqual({ _tag: "killed", by: ["g.ts > real"] });
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

  it("says so when every mutation is on the inert axis", () => {
    const report = formatReport(run([], 26), [
      { mutation: mutation({ axis: "inert" }), verdict: { _tag: "killed", by: ["a > b"] } },
    ]);
    expect(report).toContain("asked only what the guards exclude");
  });

  it("stays quiet about the axis when both are present", () => {
    const report = formatReport(run([], 26), [
      {
        mutation: mutation({ id: "i", axis: "inert" }),
        verdict: { _tag: "killed", by: ["a > b"] },
      },
      {
        mutation: mutation({ id: "w", axis: "wider" }),
        verdict: { _tag: "killed", by: ["a > c"] },
      },
    ]);
    expect(report).not.toContain("asked only what the guards exclude");
  });

  it("warns that baseline failures cannot be evidence", () => {
    const report = formatReport(run(["f.ts > flaky"], 26), [
      { mutation: mutation(), verdict: { _tag: "survived" } },
    ]);
    expect(report).toContain("already failing and cannot be evidence");
  });
});
