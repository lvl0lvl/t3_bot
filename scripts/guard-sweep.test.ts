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
});

describe("readVitestJson", () => {
  it("reads failing tests by their full name", () => {
    const stdout = JSON.stringify({
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
      testResults: [
        { name: "/repo/a.test.ts", assertionResults: [{ status: "failed", title: "refuses" }] },
        { name: "/repo/b.test.ts", assertionResults: [{ status: "failed", title: "refuses" }] },
      ],
    });
    expect(readVitestJson(stdout).failed.size).toBe(2);
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
