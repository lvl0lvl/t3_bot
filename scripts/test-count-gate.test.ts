import { describe, expect, it } from "vite-plus/test";

import {
  CannotMeasure,
  compare,
  isRegression,
  toSuite,
  type RunnerReport,
  type Suite,
} from "./test-count-gate.ts";

const suite = (entries: Record<string, ReadonlyArray<string>>): Suite =>
  new Map(Object.entries(entries).map(([path, names]) => [path, { names }]));

const FILE = "apps/server/src/a.test.ts";

/**
 * `toSuite` relativises against a real directory, so the root has to exist; the
 * FILES inside the report do not, which is why it falls back to the reported
 * path when `realpath` refuses.
 */
const REPO_ROOT = process.cwd();

const loaded = (name: string) => ({
  name: `${REPO_ROOT}/${name}`,
  status: "passed",
  assertionResults: [{ fullName: "a", status: "passed" }],
});

/** What the runner emits for a file that never loaded: no assertions, failed. */
const neverLoaded = (name: string) => ({
  name: `${REPO_ROOT}/${name}`,
  status: "failed",
  assertionResults: [],
});

const headReportWithBrokenFile: RunnerReport = {
  testResults: [loaded("apps/server/src/ok.test.ts"), neverLoaded(FILE)],
};

const baseReportWithBrokenFile: RunnerReport = {
  testResults: [neverLoaded(FILE), loaded("apps/server/src/ok.test.ts")],
};

describe("test-count-gate", () => {
  it("passes a file that only gained tests", () => {
    const rows = compare(suite({ [FILE]: ["a", "b"] }), suite({ [FILE]: ["a", "b", "c"] }));
    expect(rows.map((row) => [row.before, row.after])).toEqual([[2, 3]]);
    expect(rows.filter(isRegression)).toEqual([]);
  });

  it("fails a file that lost a test", () => {
    const rows = compare(suite({ [FILE]: ["a", "b", "c"] }), suite({ [FILE]: ["a", "b"] }));
    expect(rows.filter(isRegression).map((row) => row.path)).toEqual([FILE]);
    expect(rows[0]?.lost).toEqual(["c"]);
  });

  it("fails a name that vanished even though the COUNT went up", () => {
    // THE CASE A COUNT CANNOT SEE, and the reason this gate compares names at
    // all. On 2026-09-12 a test was split into three and its fourth property
    // was dropped: the count rose and the guard that property protected sat
    // inert for 3h14m. Three names in, four out, one of the originals gone.
    //
    // "six hours" until a lane checked the commit timestamps: 07:13:50 to
    // 10:27:55. The number was wrong in this comment and in the docstring.
    const rows = compare(
      suite({ [FILE]: ["pins the cursor", "pins the parent", "pins the sequence"] }),
      suite({ [FILE]: ["pins the cursor", "pins the parent", "pins A", "pins B"] }),
    );
    const [row] = rows;
    // Up by one, and still a regression.
    expect([row?.before, row?.after]).toEqual([3, 4]);
    expect(row?.lost).toEqual(["pins the sequence"]);
    expect(rows.filter(isRegression).length).toBe(1);
  });

  it("counts a file the head no longer runs at all", () => {
    // A deleted file, or one that fails to load: the runner reports nothing for
    // it, which must read as every test lost rather than as a file with no
    // tests to lose.
    const rows = compare(suite({ [FILE]: ["a", "b"] }), suite({}));
    expect([rows[0]?.before, rows[0]?.after]).toEqual([2, 0]);
    expect(rows.filter(isRegression).length).toBe(1);
  });

  it("fails a REPEATED name that lost one of its copies", () => {
    // THE INPUT THAT SEPARATES THE TWO CLAUSES OF isRegression, and without it
    // the count clause was dead: a lane deleted `row.after < row.before` and all
    // six tests stayed green, because every fixture that lost ground also lost a
    // distinct name.
    //
    // Two tests can share a `fullName` — `it.each` without an interpolation
    // token does it, and nothing forbids it by hand. Under set membership a
    // surviving twin masked a deleted one: base ["a","a","b"] against head
    // ["a","b","c"] reported 3 -> 3, lost nothing, and printed no row. Comparing
    // multisets is what makes the loss visible, and it is what makes the count
    // clause redundant rather than inert.
    const rows = compare(
      suite({ [FILE]: ["decodes the id", "decodes the id", "b"] }),
      suite({ [FILE]: ["decodes the id", "b", "c"] }),
    );
    const [row] = rows;
    expect([row?.before, row?.after]).toEqual([3, 3]);
    expect(row?.lost).toEqual(["decodes the id"]);
    expect(rows.filter(isRegression).length).toBe(1);
  });

  it("refuses to measure when a test file failed to LOAD in the head revision", () => {
    // NOT A DECREASE — a refusal. The runner reports a file that never loaded
    // the same way it reports a file with no tests, apart from the file-level
    // status: `assertionResults: []` with `status: "failed"`. Measured against
    // the real runner with a deliberately broken import.
    //
    // Read as zero tests, a head that does not compile prints "coverage went
    // DOWN" and lists every test in that file as lost, sending the author to
    // hunt for deletions that never happened.
    expect(() => toSuite(headReportWithBrokenFile, REPO_ROOT)).toThrow(CannotMeasure);
    expect(() => toSuite(headReportWithBrokenFile, REPO_ROOT)).toThrow(/failed to load/);
  });

  it("refuses to measure when a test file failed to LOAD in the base revision", () => {
    // THE OTHER DIRECTION, and it is the quieter one: an unloadable file in the
    // BASE reads as zero tests there, so the file looks like a GAIN and the gate
    // goes green having measured less than it claims. One parser serves both
    // revisions, so one guard covers both — this test exists because the two
    // failures are not the same failure, and a future refactor that split the
    // parse per revision must red here.
    expect(() => toSuite(baseReportWithBrokenFile, REPO_ROOT)).toThrow(CannotMeasure);
    expect(() => toSuite(baseReportWithBrokenFile, REPO_ROOT)).toThrow(/failed to load/);
  });

  it("refuses to measure when the runner matched no test files at all", () => {
    // A GATE THAT MEASURED NOTHING MUST NOT REPORT A PASS. A runner given a
    // filter that matches nothing emits valid JSON with an empty `testResults`
    // and exits non-zero; read as an empty suite, every row is `before: 0`,
    // nothing can regress, and the gate prints a green line. A security lane
    // executed exactly that and the gate exited 0 over a real deletion.
    expect(() => toSuite({ testResults: [] }, REPO_ROOT)).toThrow(CannotMeasure);
    expect(() => toSuite({ testResults: [] }, REPO_ROOT)).toThrow(/measured no test files/);
  });

  it("says nothing about a file neither side runs", () => {
    // Not a row at all — otherwise every deleted fixture in history would
    // appear as a zero-to-zero line and the table would stop being readable,
    // which is how a gate gets ignored.
    //
    // THE FIRST TWO FIXTURES ARE THE TEST. This case used to pass two EMPTY
    // maps, so the loop never ran and the guard it names was never evaluated:
    // a QA lane deleted that guard and this test stayed green, the only one of
    // the six that killed nothing. A path has to be PRESENT with no executed
    // tests to reach it — which is what the runner reports for a file whose
    // tests are all skipped.
    expect(compare(suite({ [FILE]: [] }), suite({ [FILE]: [] }))).toEqual([]);
    expect(compare(suite({ [FILE]: [] }), suite({}))).toEqual([]);
    expect(compare(suite({}), suite({}))).toEqual([]);
  });

  it("passes a file that did not change at all", () => {
    // THE ADMIT SIDE, and the commonest row in real use. Every other fixture
    // here changes something, so widening the predicate to call an UNCHANGED
    // file a regression survived all six tests — and that mutant fails the gate
    // on every PR, printing every test file in the repo as lost ground. A gate
    // that always fails gets --allow-ed wholesale, which is how a gate dies.
    const rows = compare(suite({ [FILE]: ["a", "b"] }), suite({ [FILE]: ["a", "b"] }));
    expect([rows[0]?.before, rows[0]?.after]).toEqual([2, 2]);
    expect(rows.filter(isRegression)).toEqual([]);
  });

  it("reports each file independently, sorted by path", () => {
    // EVERY OTHER FIXTURE USES ONE FILE, so the union of the two key sets, the
    // dedupe and the sort were never exercised with more than one path:
    // removing `.sort()` survived all six tests. The table is the artifact that
    // goes into a PR body, and rows in runner order mean two runs of the same
    // PR print tables a reader cannot diff.
    const rows = compare(
      suite({ "z.test.ts": ["z1", "z2"], "a.test.ts": ["a1"] }),
      suite({ "z.test.ts": ["z1"], "a.test.ts": ["a1", "a2"] }),
    );
    expect(rows.map((row) => row.path)).toEqual(["a.test.ts", "z.test.ts"]);
    // One file regressed and the other gained; they do not contaminate.
    expect(rows.filter(isRegression).map((row) => row.path)).toEqual(["z.test.ts"]);
  });

  it("treats a renamed test as a loss and a gain, not as a rename", () => {
    // DELIBERATE, and worth stating because it is the gate's main false
    // positive: renaming a test is indistinguishable from deleting one and
    // adding another, and guessing between them would mean guessing wrong in
    // the direction that hides a deletion. The author explains it with
    // `--allow`, which puts the reason in the PR body.
    const rows = compare(suite({ [FILE]: ["old name"] }), suite({ [FILE]: ["new name"] }));
    expect([rows[0]?.before, rows[0]?.after]).toEqual([1, 1]);
    expect(rows[0]?.lost).toEqual(["old name"]);
    expect(rows.filter(isRegression).length).toBe(1);
  });
});
