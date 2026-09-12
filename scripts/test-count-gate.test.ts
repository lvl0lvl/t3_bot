import { describe, expect, it } from "vite-plus/test";

// @effect-diagnostics nodeBuiltinImport:off - tests a CLI gate that reads the
// filesystem; the subject under test is the node API, not an Effect service.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  CannotMeasure,
  compare,
  describeScope,
  isRegression,
  changedPaths,
  jsonArrayPayload,
  listWorkspaces,
  selectsWorkspace,
  skippedWorkspacesTouched,
  splitScope,
  workspacesToRun,
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
  it("runs exactly the workspaces the scope line calls measured", () => {
    // THE PRINTED SCOPE AND THE EXECUTED SCOPE ARE ONE SET. They were decided in
    // two places — `splitScope` for the table, two `continue`s for the run — and
    // a QA lane deleted either `continue` with all twenty tests green. The
    // dangerous drift is the quiet one: the table claiming a workspace was
    // measured that nothing ran.
    const fixture = [
      workspace("t3", "apps/server", "vp test run"),
      workspace("@t3tools/marketing", "apps/marketing"),
      workspace("@t3tools/desktop", "apps/desktop", "vp test run"),
      workspace("@t3tools/web", "apps/web", "vp test run --project unit"),
    ];
    expect(workspacesToRun(fixture).map((entry) => entry.name)).toEqual(
      splitScope(fixture).measured,
    );
    // And it is not vacuously equal because both are everything: the fixture
    // carries one of each exclusion, and neither runs.
    expect(splitScope(fixture).measured).toEqual(["t3", "@t3tools/web"]);
  });

  it("finds the JSON array after a pnpm warning, not the bracket inside it", () => {
    // THE HEADLINE FIX OF THIS PR, AND NOTHING PINNED IT. pnpm prints
    // `[WARN] Unsupported engine: wanted: {"node":"^24.13.1"}` ahead of the
    // payload; the parse used to take the first `[` anywhere, which is the
    // bracket of `[WARN]`. A history lane found the tolerance had been MOVED
    // here rather than removed, while the PR body claimed it was gone.
    //
    // The discriminator is the character AFTER the bracket: a JSON array opens
    // with whitespace, `{` or `]`; `[WARN]` opens with a letter.
    const warned = [
      '[WARN] Unsupported engine: wanted: {"node":"^24.13.1"} (current: {"node":"v24.12.0"})',
      "[",
      '  { "name": "t3", "path": "/repo/apps/server" }',
      "]",
      "",
    ].join("\n");
    const payload = jsonArrayPayload(warned);
    expect(payload).toBeDefined();
    expect(JSON.parse(payload!)).toEqual([{ name: "t3", path: "/repo/apps/server" }]);

    // A compact payload on one line is still found.
    expect(JSON.parse(jsonArrayPayload('[{"name":"t3"}]')!)).toEqual([{ name: "t3" }]);
    // An empty array is a payload, not an absence.
    expect(jsonArrayPayload("[]")).toBe("[]");
    // And a stream with no payload at all is undefined, so the caller refuses
    // rather than parsing a warning.
    expect(jsonArrayPayload("[WARN] something\n[WARN] else")).toBeUndefined();
    expect(jsonArrayPayload("")).toBeUndefined();
  });

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

  it("finds only pnpm-workspace members, so a nested checkout cannot be one", () => {
    // THE REASON THIS ASKS THE PACKAGE MANAGER INSTEAD OF WALKING DIRECTORIES.
    // A walk finds `.claude/worktrees/<other branch>` — a full checkout of
    // somebody else's branch — and measures its tests as this tree's. That is
    // not hypothetical: it is what the PM's gate run on main did, collecting
    // `scripts/build-desktop-artifact.test.ts` out of a senior's worktree.
    // `pnpm ls` answers from pnpm-workspace.yaml, so a nested checkout is not a
    // member and cannot be found — by construction, not by an exclusion list
    // someone has to remember to extend.
    // THE PROPERTY IS MEMBERSHIP, NOT A PATH SUBSTRING. The first version of
    // this test asserted no path contains `/.claude/` — and a quality lane
    // measured that in a senior's own worktree, which is where CLAUDE.md tells
    // seniors to work, ALL SIXTEEN workspace paths contain it, starting with the
    // repo root. It reds for every reviewer and passes for the author, who
    // happened to develop this under /private/tmp. It also never tested its
    // stated property: a nested checkout IS inside the repo root, so the
    // enclosing assertion passes for one.
    //
    // What actually excludes a nested checkout is pnpm workspace membership, so
    // that is what this asserts: every returned path is one of the directories
    // pnpm-workspace.yaml's globs reach, relative to the repo root.
    const real = NodeFS.realpathSync(REPO);
    const globs = NodeFS.readFileSync(NodePath.join(REPO, "pnpm-workspace.yaml"), "utf8")
      .split("\n")
      .map((line) => /^\s*-\s*(\S+)\s*$/.exec(line)?.[1])
      .filter((entry): entry is string => entry !== undefined && !entry.includes(":"));
    expect(globs.length).toBeGreaterThan(0);

    for (const entry of listWorkspaces(REPO)) {
      const relative = NodePath.relative(real, NodeFS.realpathSync(entry.path));
      expect(relative.startsWith("..")).toBe(false);
      // Every member sits exactly where a glob says it may: `apps/*` admits
      // `apps/server` and nothing deeper, `scripts` admits itself.
      const matched = globs.some((glob) =>
        glob.endsWith("/*") ? NodePath.dirname(relative) === glob.slice(0, -2) : relative === glob,
      );
      expect({ path: relative, matched }).toEqual({ path: relative, matched: true });
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

  it("puts a workspace declared unmeasurable in a cold tree in its OWN bucket", () => {
    // A THIRD BUCKET, and it is not the same as having no tests: this one HAS a
    // test script and the gate still cannot run it against a cold base. It must
    // not land in `measured`, because the scope line would then claim a
    // workspace nobody measured.
    //
    // BY FIXTURE, not by arithmetic. A mutant that reported it as measured was
    // first caught only by a count identity over the real repo — sum of the
    // three buckets equals the workspace list — which reds for the wrong
    // reason and stops reding the day the identity is restored some other way.
    const scope = splitScope([
      workspace("t3", "apps/server", "vp test run"),
      workspace("@t3tools/desktop", "apps/desktop", "vp test run"),
    ]);
    expect(scope.measured).toEqual(["t3"]);
    expect(scope.unmeasurable).toEqual(["@t3tools/desktop"]);
    expect(scope.skipped).toEqual([]);
  });

  it("describes the real repo's scope as a split of its real workspaces", () => {
    // The wiring, once: `describeScope` really does run the enumeration through
    // the split rather than computing something of its own. THREE buckets — a
    // workspace is measured, skipped for having no `test` script, or skipped as
    // unmeasurable in a cold base tree — and every workspace lands in exactly
    // one, so a workspace cannot fall out of the scope line entirely.
    // THE TARGET IS PASSED, NOT INHERITED. This read the ambient
    // TEST_COUNT_GATE_TARGET — the narrowing knob documented in this file's own
    // Usage block — so a developer who exported it to prove something locally
    // and then ran the suite got a false red on the merge gate's own tests. A
    // quality lane measured both halves reding under `=apps/web`.
    const scope = describeScope(REPO, "");
    const listed = listWorkspaces(REPO);
    expect(scope.measured.length + scope.skipped.length + scope.unmeasurable.length).toBe(
      listed.length,
    );
    expect(scope.measured).toContain("@t3tools/scripts");
  });

  it("names the workspace a test file was MOVED OUT OF, not just where it landed", () => {
    // THE PRODUCER, not a hand-written array. Both directions of
    // `skippedWorkspacesTouched` were already tested — over paths this file
    // typed out itself. Nothing exercised the function whose input comes from
    // another program, and that is where the hole was.
    //
    // `git diff --name-only` detects renames by default and prints ONE path for
    // the pair: the DESTINATION. So moving a test file out of a skipped
    // workspace produced a changed-path list that never named that workspace,
    // the refusal never fired, and the gate went green over a PR that removed
    // test files from a workspace it refuses to measure. Executed by a
    // contracts lane in a throwaway repo before it was fixed here.
    //
    // A REAL REPO AND A REAL `git mv`, because the property belongs to git's
    // flags rather than to this code: a fixture of strings would pass against
    // the broken version.
    const repo = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "count-gate-rename-"));
    try {
      const git = (...args: ReadonlyArray<string>) =>
        NodeChildProcess.execFileSync("git", [...args], { cwd: repo, encoding: "utf8" });
      git("init", "--quiet");
      git("config", "user.email", "gate@example.invalid");
      git("config", "user.name", "count gate test");
      NodeFS.mkdirSync(NodePath.join(repo, "apps/desktop/src"), { recursive: true });
      NodeFS.mkdirSync(NodePath.join(repo, "apps/server/src"), { recursive: true });
      // Long enough that git's similarity detection calls it a rename rather
      // than a delete plus an add — which is the case that was broken.
      NodeFS.writeFileSync(
        NodePath.join(repo, "apps/desktop/src/Thing.test.ts"),
        Array.from({ length: 40 }, (_, index) => `it("case ${index}", () => {});`).join("\n"),
      );
      git("add", "-A");
      git("commit", "--quiet", "-m", "base");
      const base = git("rev-parse", "HEAD").trim();
      git("mv", "apps/desktop/src/Thing.test.ts", "apps/server/src/Thing.test.ts");
      git("commit", "--quiet", "-m", "move the tests out");

      const changed = changedPaths(repo, base);
      expect(changed).toContain("apps/desktop/src/Thing.test.ts");
      expect(changed).toContain("apps/server/src/Thing.test.ts");

      // And the refusal that depends on it actually fires.
      const desktop: Workspace = {
        name: "@t3tools/desktop",
        path: NodePath.join(repo, "apps/desktop"),
        testScript: "vp test run",
      };
      expect(skippedWorkspacesTouched(changed, [desktop], repo)).toEqual(["@t3tools/desktop"]);
    } finally {
      NodeFS.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("does not refuse a PR that touches only workspaces it measures", () => {
    // THE ADMIT SIDE, and without it the refusal below is satisfied by a gate
    // that refuses every PR. A skip is acceptable scope while the PR did not
    // change it — which is the ordinary case and must stay ordinary.
    const desktop = workspace("@t3tools/desktop", "apps/desktop", "vp test run");
    expect(
      skippedWorkspacesTouched(
        ["apps/server/src/ws.ts", "scripts/test-count-gate.ts"],
        [desktop],
        REPO,
      ),
    ).toEqual([]);
  });

  it("refuses a PR that touches a workspace the gate skips", () => {
    // SCOPE YOU CHANGED IS SCOPE YOU HAVE TO MEASURE. Skipping apps/desktop is
    // tolerable until the PR edits apps/desktop, at which point a green gate
    // would be asserting something it never looked at.
    const desktop = workspace("@t3tools/desktop", "apps/desktop", "vp test run");
    expect(
      skippedWorkspacesTouched(["apps/desktop/src/backend/Thing.ts"], [desktop], REPO),
    ).toEqual(["@t3tools/desktop"]);
    // A path that merely STARTS with the same letters is not inside it: the
    // comparison is on a directory boundary, not a string prefix.
    expect(skippedWorkspacesTouched(["apps/desktop-notes/x.ts"], [desktop], REPO)).toEqual([]);
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

describe("the gate refuses rather than measuring nothing", () => {
  // EXECUTED, THROUGH THE REAL BINARY. A QA lane mutated five of the six
  // refusals and nothing red, because every test in this file drives a pure
  // helper. Four of them return in about two seconds and need no base worktree,
  // so there was never a cost argument for leaving them unpinned — only the
  // absence of a seam, and a child process is the seam.
  const runGate = (args: ReadonlyArray<string>, target?: string) => {
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["--experimental-strip-types", NodePath.join(REPO, "scripts/test-count-gate.ts"), ...args],
      {
        cwd: REPO,
        encoding: "utf8",
        // BOUNDED, because every case here is meant to refuse BEFORE the
        // expensive work. If a refusal is ever removed the gate walks on into a
        // cold base worktree and a full install — minutes, not seconds — so a
        // regression would surface as a hung suite rather than a red one. That
        // happened during this PR's own mutation run: two mutants turned a
        // two-second assertion into a base-tree build. The timeout turns it back
        // into a failure.
        timeout: 60_000,
        env:
          target === undefined ? process.env : { ...process.env, TEST_COUNT_GATE_TARGET: target },
      },
    );
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };

  it("refuses a target that selects no workspace at all", () => {
    const run = runGate(["--base", "origin/main"], "no-such-workspace-zzz");
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("matches");
    // NOT a coverage verdict. Exit 2 and exit 1 mean opposite things to an
    // author, and the file's contract is that they are never confused.
    expect(run.stdout).not.toContain("no test lost");
  });

  it("refuses a selection in which every workspace is skipped", () => {
    // THE FAIL-OPEN. Without this refusal both sides produce an empty suite,
    // `compare` returns no rows, and the gate writes "no test lost by count or
    // by name" over a measurement of nothing — which is the #26 Critical, one
    // level up. `@t3tools/marketing` declares no `test` script, so selecting
    // only it selects nothing runnable.
    const run = runGate(["--base", "origin/main"], "marketing");
    expect(run.status).toBe(2);
    expect(run.stdout).not.toContain("no test lost");
  });

  it("refuses a base ref it cannot diff", () => {
    const run = runGate(["--base", "refs/heads/no-such-ref-zzz"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("could not diff");
  });

  it("refuses an option it does not know", () => {
    // A mistyped `--allow` means the author BELIEVES a decrease is explained.
    const run = runGate(["--base", "origin/main", "--allowed", "x=y"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("unknown option");
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
    expect(() =>
      toSuite(headReportWithBrokenFile, REPO_ROOT, "@t3tools/web in the head tree"),
    ).toThrow(CannotMeasure);
    expect(() =>
      toSuite(headReportWithBrokenFile, REPO_ROOT, "@t3tools/web in the head tree"),
    ).toThrow(/failed to load/);
  });

  it("refuses to measure when a test file failed to LOAD in the base revision", () => {
    // THE OTHER DIRECTION, and it is the quieter one: an unloadable file in the
    // BASE reads as zero tests there, so the file looks like a GAIN and the gate
    // goes green having measured less than it claims. One parser serves both
    // revisions, so one guard covers both — this test exists because the two
    // failures are not the same failure, and a future refactor that split the
    // parse per revision must red here.
    expect(() =>
      toSuite(baseReportWithBrokenFile, REPO_ROOT, "@t3tools/web in the base tree"),
    ).toThrow(CannotMeasure);
    expect(() =>
      toSuite(baseReportWithBrokenFile, REPO_ROOT, "@t3tools/web in the base tree"),
    ).toThrow(/failed to load/);
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
