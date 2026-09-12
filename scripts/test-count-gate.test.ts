import { describe, expect, it } from "vite-plus/test";

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  CannotMeasure,
  compare,
  describeScope,
  isRegression,
  listWorkspaces,
  selectsWorkspace,
  splitScope,
  toSuite,
  type RunnerReport,
  type Suite,
  type Workspace,
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

const REPO = NodePath.resolve(import.meta.dirname, "..");

const workspace = (name: string, path: string, testScript?: string): Workspace => ({
  name,
  path: NodePath.join(REPO, path),
  testScript,
});

describe("workspace enumeration", () => {
  it("drops the ROOT package, whose test script runs every other workspace", () => {
    // `@t3tools/monorepo`'s `test` is `vp run -r test` — an aggregator. Left in
    // the list it runs the whole repo once more inside the loop that is already
    // running it: every file measured twice, and the second pass nested.
    const names = listWorkspaces(REPO).map((entry) => entry.name);
    expect(names).not.toContain("@t3tools/monorepo");
    // And the enumeration is not empty, so the assertion above is about the
    // root rather than about listWorkspaces returning nothing.
    expect(names).toContain("@t3tools/scripts");
  });

  it("finds no workspace outside the repo, and none in a nested checkout", () => {
    // THE REASON THIS ASKS THE PACKAGE MANAGER INSTEAD OF WALKING DIRECTORIES.
    // A walk finds `.claude/worktrees/<other branch>` — a full checkout of
    // somebody else's branch — and measures its tests as this tree's. That is
    // not hypothetical: it is what the PM's gate run on main did, collecting
    // `scripts/build-desktop-artifact.test.ts` out of a senior's worktree.
    // `pnpm ls` answers from pnpm-workspace.yaml, so a nested checkout is not a
    // member and cannot be found — by construction, not by an exclusion list
    // someone has to remember to extend.
    const real = NodeFS.realpathSync(REPO);
    for (const entry of listWorkspaces(REPO)) {
      expect(NodeFS.realpathSync(entry.path).startsWith(real)).toBe(true);
      expect(entry.path).not.toContain(`${NodePath.sep}.claude${NodePath.sep}`);
      expect(entry.path).not.toContain(`${NodePath.sep}node_modules${NodePath.sep}`);
    }
  });

  it("puts a workspace with no `test` script on the SKIPPED side, by name", () => {
    // A WORKSPACE WITH NO `test` SCRIPT IS SCOPE THE GATE DOES NOT COVER, so it
    // is named in the output rather than dropped silently.
    //
    // THE FIXTURE HAS ONE, which is the entire point. The first version of this
    // test asked the real repo whether the split was "consistent" — and
    // `measured: everything, skipped: []` is perfectly consistent, so a mutant
    // that reported every skipped workspace as measured survived it. The input
    // that separates the two implementations is a workspace with no test
    // script, and a test that will not name one has to bring one.
    const scope = splitScope([
      workspace("t3", "apps/server", "vp test run"),
      workspace("@t3tools/marketing", "apps/marketing"),
      workspace("@t3tools/web", "apps/web", "vp test run --project unit"),
    ]);
    expect(scope.measured).toEqual(["t3", "@t3tools/web"]);
    expect(scope.skipped).toEqual(["@t3tools/marketing"]);
  });

  it("describes the real repo's scope as a split of its real workspaces", () => {
    // The wiring, once: `describeScope` really does run the enumeration through
    // the split rather than computing something of its own.
    const scope = describeScope(REPO);
    const listed = listWorkspaces(REPO);
    expect(scope.measured.length + scope.skipped.length).toBe(listed.length);
    expect(scope.measured).toContain("@t3tools/scripts");
  });

  it("selects a workspace by package name, by directory, or by nothing at all", () => {
    const server = workspace("t3", "apps/server", "vp test run");
    const web = workspace("@t3tools/web", "apps/web", "vp test run");
    // An empty target is every workspace: the default is the whole repo.
    expect(selectsWorkspace("", server, REPO)).toBe(true);
    expect(selectsWorkspace("", web, REPO)).toBe(true);
    // By directory, which is how the interim ruling narrowed it.
    expect(selectsWorkspace("apps/server", server, REPO)).toBe(true);
    expect(selectsWorkspace("apps/server", web, REPO)).toBe(false);
    // By package name, because `t3` is what the server is called and a reader
    // who knows the filter from CI will reach for it.
    expect(selectsWorkspace("t3", server, REPO)).toBe(true);
    // A target that matches nothing selects nothing — `main` turns that into a
    // refusal rather than an empty, green run.
    expect(selectsWorkspace("apps/nonexistent", server, REPO)).toBe(false);
    expect(selectsWorkspace("apps/nonexistent", web, REPO)).toBe(false);
  });
});

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

  it("refuses to measure when a workspace that has tests reported none", () => {
    // A GATE THAT MEASURED NOTHING MUST NOT REPORT A PASS. A runner that
    // matched nothing emits valid JSON with an empty `testResults`; read as an
    // empty suite, every row is `before: 0`, nothing can regress, and the gate
    // prints a green line. A security lane executed exactly that and the gate
    // exited 0 over a real deletion.
    //
    // PER WORKSPACE SINCE `t3_bot-x4v`, and the workspace NAME is what makes
    // the refusal actionable: "nothing measured" over sixteen workspaces does
    // not say which one to go and look at. A workspace that legitimately has no
    // tests declares no `test` script and is skipped by name in the scope line,
    // so it never reaches here.
    expect(() => toSuite({ testResults: [] }, REPO_ROOT, "@t3tools/web")).toThrow(CannotMeasure);
    expect(() => toSuite({ testResults: [] }, REPO_ROOT, "@t3tools/web")).toThrow(
      /@t3tools\/web reported no test files/,
    );
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
