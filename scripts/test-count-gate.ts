// @effect-diagnostics nodeBuiltinImport:off - a CLI gate that shells out and reads files.
/**
 * Per-file test counts AND test NAMES, base against head, FROM THE RUNNER.
 *
 * BOTH HALVES GATE, on every run. The title used to say counts and the name
 * comparison went unmentioned, which undersold the half that does the work:
 * `--names` only controls whether lost names are PRINTED. A review lane read
 * this docstring and could not tell that names were compared at all.
 *
 * CLAUDE.md's Tests rule says a test count may not go down silently. Until this
 * script existed the comparison was prose: the author measured by hand, wrote a
 * table in the PR body, and the PM read it. That is a gate made of remembering,
 * and #21's history lane pointed out that the rule named a mechanism nobody had
 * built.
 *
 * WHY THE RUNNER AND NOT A GREP. `grep -c "it("` counts strings, comments and
 * the word inside `commit(`; it also cannot see a skipped test, a `describe`
 * that returns early, or a file that fails to load. The runner reports what it
 * EXECUTED, which is the number the rule is about.
 *
 * THE TWO INCIDENTS, kept distinct, because an earlier version of this file
 * merged them and a history lane measured the merge:
 *
 *   08:01  #13's range-replace (`bb3b61bb3`) rewrote one `it.effect` block and
 *          took three direct-gateway assertions with it. Walt wrote the rule one
 *          minute later citing THIS. Measured: that file ran 11 tests before and
 *          11 after — THE COUNT NEVER MOVED. A pure count gate, which is what
 *          the rule's headline describes, would have passed it clean. What did
 *          change was one NAME, because the rewrite renamed the block, so the
 *          name half reports that file `11 -> 11, lost 1` and a reader following
 *          that row to `git diff` finds the three deleted assertions.
 *   10:30  #18's split-into-three (`9b4f60f22`) dropped a fourth property while
 *          the count went UP, and the guard it protected sat inert for 3h14m.
 *          This is a SECOND, LATER failure. It did not prompt the rule — it
 *          could not have, the rule was 2h28m old — and this file used to say it
 *          did.
 *
 * WHAT THIS CANNOT SEE, stated first rather than in a footnote: A TEST REWRITTEN
 * UNDER THE SAME NAME. Delete every assertion inside a block and keep its title
 * and this gate reports nothing — same count, same names. That is the true floor,
 * and it is narrower than the floor this file used to claim: the 08:01 incident
 * was offered here as the example of what the gate cannot catch, and the gate
 * catches it, by the rename. `git diff` over the test files is the check for a
 * same-name rewrite, and it is the author's, not this script's.
 *
 * WHAT IT MEASURES: the whole repo, unless narrowed. `TEST_COUNT_GATE_TARGET` is
 * a filter passed to the runner; it exists so a human proving something locally
 * can wait seconds instead of minutes, and CI pays the full cost. A narrowed run
 * says so in the first line of its own table, so a table pasted into a PR body
 * cannot read as a full run.
 *
 * THE RULE HAS THREE OBLIGATIONS AND THIS COVERS ONE AND A HALF. Counts and
 * names, mechanised. The reason for a decrease, forced into words by `--allow`
 * and printed — though nothing here checks it reached the PR body. Re-running the
 * previous PR's mutants on a changed file: NOT mechanised, and the reminder
 * prints only on a red run. A green gate is not the Tests rule discharged.
 *
 * Usage:
 *   pnpm test:count-gate --base origin/main [--allow path[#test name]=reason]...
 *   pnpm test:count-gate --base origin/main --names
 *   TEST_COUNT_GATE_TARGET=apps/web pnpm test:count-gate --base origin/main
 *
 * `--allow` takes a path and a reason; a decrease in that file is then reported
 * but not fatal, and the reason is printed so it lands in the PR body rather
 * than in someone's memory. `path#test name=reason` allows ONE named loss: the
 * bare-path form allows everything that file lost, which is a hole the shape of
 * the incident the rule was written for.
 *
 * EXIT CODES, because a gate that cannot say why it failed teaches people to
 * ignore it:
 *   0  measured, nothing lost by count or by name
 *   1  measured, something was lost and nothing explained it
 *   2  COULD NOT MEASURE — no runner, a runner that matched nothing, a base ref
 *      that will not check out (a shallow CI clone does this), a test file that
 *      fails to load in either revision, an `--allow` that matches nothing.
 *      Never confuse this with 1: "your head does not compile" must not reach an
 *      author as "you deleted tests".
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/**
 * A table is a stream of lines, not a stream of events, so this writes to the
 * stream rather than through `Logger`, which would stamp every row with a level
 * and a time and make the output unreadable as a table.
 *
 * `resolve-previous-release-tag.ts` also writes straight to the stream, but for
 * its own reason — a `key=value` line another process reads — so it is precedent
 * for the mechanism and not for the reason. This file used to claim it was both.
 */
const write = (line: string) => process.stdout.write(`${line}\n`);
const writeErr = (line: string) => process.stderr.write(`${line}\n`);

/**
 * "I could not measure" — exit 2, never exit 1.
 *
 * A gate with one failure signal cries deletion when the real fault is a shallow
 * checkout or a broken import, and the first false red is what teaches people to
 * ignore it.
 */
export class CannotMeasure extends Error {}

/** The shape this reads out of `--reporter=json`; the runner emits much more. */
export interface RunnerReport {
  readonly testResults?: ReadonlyArray<{
    readonly name?: string;
    /** The FILE's status. `"failed"` with no assertions means it never loaded. */
    readonly status?: string;
    /** The collection error, when the file failed to load. Worth repeating. */
    readonly message?: string;
    readonly assertionResults?: ReadonlyArray<{
      readonly fullName?: string;
      readonly title?: string;
      readonly status?: string;
    }>;
  }>;
}

export interface FileTests {
  /** Executed test names, in the order the runner reported them. */
  readonly names: ReadonlyArray<string>;
}

/**
 * Keyed by REPO-ROOT-RELATIVE, POSIX, REALPATH-RESOLVED path.
 *
 * That domain is the load-bearing term and it belongs on the type, because every
 * producer must satisfy it and two suites keyed differently compare as garbage
 * rather than failing: one spelling of a file reads as wholly deleted and the
 * other as wholly added, on a tree where nothing changed. The runner reports
 * absolute paths and the base lives in a temp worktree, so both sides are
 * relativised; macOS reports `/private/var` for a `/var` temp dir, so both sides
 * go through `realpath` first.
 */
export type Suite = Map<string, FileTests>;

/**
 * WHICH WORKSPACES TO MEASURE, and the default is all of them.
 *
 * A substring matched against the workspace's package NAME and its directory,
 * so `apps/server`, `server` and `t3` all select the server. Narrowing is
 * printed in the table's first line, so a narrowed run cannot be pasted into a
 * PR body as a full one.
 *
 * IT USED TO BE A RUNNER FILTER FOR ONE ROOT-PROJECT RUN, and that is the bug
 * this file was rewritten for (`t3_bot-x4v`): see `listWorkspaces`.
 */
const TEST_TARGET = process.env["TEST_COUNT_GATE_TARGET"] ?? "";

/**
 * The runner's own account of what ran.
 *
 * THE PAYLOAD STARTS AT THE FIRST BRACE because some wrapper versions print a
 * banner first. The input that breaks that: a banner that itself contains a
 * brace — a printed config object, a `{a,b}` glob echoed back, a JSON progress
 * line. Then `JSON.parse` throws on the banner instead, which is why the throw
 * below carries the head of the stream rather than a bare SyntaxError.
 */
/** One workspace, as the package manager reports it. */
export interface Workspace {
  readonly name: string;
  /** Absolute, from the package manager — never from walking directories. */
  readonly path: string;
  /** Its own `test` script, or undefined when it declares none. */
  readonly testScript: string | undefined;
}

/**
 * The workspaces, FROM THE PACKAGE MANAGER.
 *
 * NOT BY WALKING DIRECTORIES, and that is not a stylistic preference: a walk
 * finds `.claude/worktrees/<other branch>` and measures another branch's tests
 * as this tree's. That happened — the PM's gate run on main collected
 * `scripts/build-desktop-artifact.test.ts` out of a senior's nested checkout
 * and failed to load it against this tree's config. `pnpm ls` answers from
 * `pnpm-workspace.yaml`, so a nested checkout is not a member and cannot be
 * found by construction rather than by an exclusion someone has to maintain.
 *
 * THE ROOT PACKAGE IS DROPPED. Its `test` script is `vp run -r test` — an
 * aggregator that runs every other workspace — so including it would run the
 * whole repo once more inside a loop that is already running it.
 */
export function listWorkspaces(repoRoot: string): ReadonlyArray<Workspace> {
  const result = NodeChildProcess.spawnSync("pnpm", ["ls", "-r", "--depth", "-1", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  const start = stdout.indexOf("[");
  if (start === -1) {
    throw new CannotMeasure(
      `could not list the workspaces in ${repoRoot}. Without them there is nothing to measure, ` +
        `and measuring nothing must not report a pass.\n` +
        (result.stderr ?? "").slice(-2000),
    );
  }
  const listed = JSON.parse(stdout.slice(start)) as ReadonlyArray<{
    readonly name?: string;
    readonly path?: string;
  }>;
  const realRoot = NodeFS.realpathSync(repoRoot);
  const workspaces: Array<Workspace> = [];
  for (const entry of listed) {
    if (entry.name === undefined || entry.path === undefined) continue;
    if (NodeFS.realpathSync(entry.path) === realRoot) continue;
    const manifest = JSON.parse(
      NodeFS.readFileSync(NodePath.join(entry.path, "package.json"), "utf8"),
    ) as { readonly scripts?: Record<string, string> };
    workspaces.push({
      name: entry.name,
      path: entry.path,
      testScript: manifest.scripts?.["test"],
    });
  }
  return workspaces;
}

/** Whether `TEST_COUNT_GATE_TARGET` selects this workspace. */
export const selectsWorkspace = (target: string, workspace: Workspace, repoRoot: string) =>
  target === "" ||
  workspace.name.includes(target) ||
  NodePath.relative(repoRoot, workspace.path).includes(target);

/**
 * One workspace's own test run, read from a FILE rather than from stdout.
 *
 * `--outputFile` exists and stdout does not survive contact with a package
 * manager: `pnpm` prints `[WARN] Unsupported engine: wanted: {"node":"^24.13.1"}`
 * ahead of the payload, and the old "parse from the first brace" tolerance
 * would have sliced from the brace inside that warning. That was the exact
 * breaking input the old comment named, reached the first time this ran through
 * a package script.
 *
 * THE PACKAGE'S OWN SCRIPT, not a `vp test run` this file invents. `apps/web`
 * runs `--project unit` and `apps/desktop` runs `--passWithNoTests`; a gate that
 * substituted its own invocation would measure a configuration nobody ships,
 * which is the whole defect being repaired here.
 */
function runWorkspace(repoRoot: string, workspace: Workspace, reportDir: string): Suite {
  const outputFile = NodePath.join(
    reportDir,
    `${workspace.name.replace(/[^A-Za-z0-9_-]/g, "-")}.json`,
  );
  const result = NodeChildProcess.spawnSync(
    "pnpm",
    ["--filter", workspace.name, "run", "test", "--reporter=json", `--outputFile=${outputFile}`],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (!NodeFS.existsSync(outputFile)) {
    throw new CannotMeasure(
      `${workspace.name} produced no report in ${repoRoot}. A workspace that cannot RUN is not a ` +
        `workspace with no tests, and reporting it as empty would turn a broken tree into a ` +
        `clean pass.\n` +
        (result.stderr ?? "").slice(-2000),
    );
  }
  const parsed = JSON.parse(NodeFS.readFileSync(outputFile, "utf8")) as RunnerReport;
  return toSuite(parsed, repoRoot, workspace.name);
}

/**
 * What a run of this tree would measure, and what it would not.
 *
 * SEPARATE FROM RUNNING IT so `main` can print the scope on the first line of
 * the table, before minutes of test runs. A skipped workspace is scope, and
 * scope that is not printed is the thing this gate exists to stop.
 *
 * The BASE tree enumerates its own workspaces when it runs, because a workspace
 * can be added or removed by the very PR being measured; this describes HEAD.
 */
export function describeScope(repoRoot: string) {
  const selected = listWorkspaces(repoRoot).filter((workspace) =>
    selectsWorkspace(TEST_TARGET, workspace, repoRoot),
  );
  return {
    measured: selected.filter((w) => w.testScript !== undefined).map((w) => w.name),
    skipped: selected.filter((w) => w.testScript === undefined).map((w) => w.name),
  };
}

/**
 * Every selected workspace, merged.
 *
 * Keys are repo-root-relative on both sides, so two workspaces cannot collide
 * and base and head stay comparable.
 */
function runSuite(cwd: string): Suite {
  const repoRoot = cwd;
  const all = listWorkspaces(repoRoot);
  const selected = all.filter((workspace) => selectsWorkspace(TEST_TARGET, workspace, repoRoot));
  if (selected.length === 0) {
    throw new CannotMeasure(
      `no workspace in ${repoRoot} matches '${TEST_TARGET}'. A gate that selected nothing must ` +
        `not report a pass.`,
    );
  }
  const reportDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-count-gate-reports-"));
  try {
    const merged: Suite = new Map();
    for (const workspace of selected) {
      // A WORKSPACE WITH NO `test` SCRIPT IS SKIPPED AND SAID. Skipping is
      // scope, and unprinted scope is the thing this gate exists to stop.
      if (workspace.testScript === undefined) continue;
      for (const [path, tests] of runWorkspace(repoRoot, workspace, reportDir)) {
        merged.set(path, tests);
      }
    }
    if (merged.size === 0) {
      throw new CannotMeasure(
        `the selected workspaces measured no test files in ${repoRoot}. A gate that measured ` +
          `nothing must not report a pass.`,
      );
    }
    return merged;
  } finally {
    NodeFS.rmSync(reportDir, { recursive: true, force: true });
  }
}

/**
 * The runner's report as a `Suite`, separated from the running so its refusals
 * can be tested without two full suite runs.
 *
 * A GATE THAT CANNOT MEASURE MUST SAY SO. Every refusal here is `CannotMeasure`
 * (exit 2), never a decrease: a head that does not compile reported as "coverage
 * went DOWN" sends the author hunting for deleted tests that are still there.
 */
export function toSuite(parsed: RunnerReport, cwd: string, workspace?: string): Suite {
  const suite: Suite = new Map();
  const realCwd = NodeFS.realpathSync(cwd);
  for (const file of parsed.testResults ?? []) {
    if (file.name === undefined) continue;
    // Relative, so base and head agree: they live in different directories and
    // an absolute path would make every file look added and removed at once.
    //
    // THROUGH `realpath` ON BOTH SIDES, which is not belt and braces. The base
    // worktree lands under the system temp dir, and on macOS that is `/var/...`
    // while the runner reports `/private/var/...` — the same symlink that makes
    // twelve tests in this repo fail on a developer machine. Relativising the
    // two unresolved paths yields `../../../../../private/var/...`, so every
    // file appears as one removed and one added and the gate cries wolf on an
    // unchanged tree. Measured: it did exactly that on its first end-to-end run.
    // REALPATH, FALLING BACK TO THE RAW PATH. Resolution is what makes base and
    // head comparable (macOS reports `/private/var` for a `/var` temp dir), but
    // a path the runner reported and the filesystem no longer has must not take
    // the whole gate down with an ENOENT — and a fixture in a test has no file
    // at all.
    let resolved = file.name;
    try {
      resolved = NodeFS.realpathSync(file.name);
    } catch {
      resolved = file.name;
    }
    const relative = NodePath.relative(realCwd, resolved);
    const assertions = file.assertionResults ?? [];
    // A FILE THAT FAILED TO LOAD IS NOT A FILE WITH ZERO TESTS. The runner
    // reports the two identically apart from this status: a bad import yields
    // `assertionResults: []` with `status: "failed"`. Measured against the real
    // runner, not assumed.
    //
    // Read as zero it runs in both directions and both are wrong. In HEAD the
    // file reads as every test deleted, so the gate prints "coverage went DOWN"
    // over tests that still exist. In BASE it reads as a gain, so the gate goes
    // green while measuring less than it claims.
    if (assertions.length === 0 && file.status === "failed") {
      throw new CannotMeasure(
        `${relative} failed to load in ${workspace ?? cwd}, so its tests were never counted. ` +
          `Fix the file and re-run: a file that cannot load is not a file with no tests.` +
          // THE RUNNER ALREADY SAYS WHAT BROKE. A bug lane counted three signals
          // separating "did not load" from "has no tests" — this status, the
          // top-level `success`, and this message — and the parser read none of
          // them. Repeating it here is the difference between a refusal the
          // author can act on and one they have to reproduce.
          (file.message === undefined || file.message === "" ? "" : `\n  ${file.message}`),
      );
    }
    const names = assertions
      // SKIPPED IS A DECREASE. A test turned into `it.skip` still appears in the
      // report and would otherwise count as present, which is exactly the
      // silent loss the rule is about. Measured: the runner really does emit
      // `status: "skipped"` for one, and this filter really does drop it.
      .filter((test) => test.status === "passed" || test.status === "failed")
      .map((test) => test.fullName ?? test.title ?? "<unnamed>");
    suite.set(relative, { names });
  }
  // ZERO FILES IS NOT ZERO REGRESSIONS. A runner that matched nothing emits
  // perfectly valid JSON with an empty `testResults`, and an empty base makes
  // every row `before: 0`, so nothing can regress and the gate passes having
  // measured nothing at all. A security lane executed exactly that against the
  // real runner — a target matching no files gives `success: false`, exit 1, and
  // valid JSON — and the gate said "no test name lost" and exited 0.
  if (suite.size === 0 && workspace !== undefined) {
    throw new CannotMeasure(
      `${workspace} reported no test files. A workspace that declares a \`test\` script and then ` +
        `measures nothing is a broken invocation, not a workspace with no tests — a workspace ` +
        `with none is skipped by name and printed.`,
    );
  }
  return suite;
}

/**
 * Base runs in its own worktree with its own install.
 *
 * NEVER in the author's tree, and not by checking out over it: CLAUDE.md's
 * worktree rule exists because a review lane once "restored" a tree to what it
 * had read and reverted two correctness fixes. A gate that stashed the author's
 * work to measure the base would be that incident with a cron job.
 */
function withBaseWorktree<A>(baseRef: string, use: (cwd: string) => A): A {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-count-gate-"));
  const tree = NodePath.join(root, "base");
  // EVERYTHING INSIDE THE TRY. `worktree add` used to sit above it, so a failed
  // add — which is what a shallow CI clone produces — never reached the finally:
  // the temp root leaked, and a half-registered worktree stayed in
  // `git worktree list` IN THE DEVELOPER'S OWN REPO, where it changed how the
  // next run failed. A lane measured five leaked roots and a stale registration
  // after an interrupt.
  //
  // CHILD OUTPUT GOES TO STDERR. The product of this script is a table an author
  // pastes into a PR body, and a cold `pnpm install` log on the same stream
  // turns that into a scroll-and-select.
  try {
    NodeChildProcess.execFileSync("git", ["worktree", "add", "--detach", tree, baseRef], {
      stdio: ["ignore", 2, 2],
    });
    NodeChildProcess.execFileSync("pnpm", ["install", "--frozen-lockfile"], {
      cwd: tree,
      stdio: ["ignore", 2, 2],
    });
    return use(tree);
  } catch (error) {
    if (error instanceof CannotMeasure) throw error;
    throw new CannotMeasure(
      `could not prepare the base worktree at ${baseRef}: ` +
        `${error instanceof Error ? error.message : String(error)}. ` +
        `A shallow clone does this — a CI checkout defaults to depth 1, and the ref has to ` +
        `exist locally before this can check it out.`,
    );
  } finally {
    if (NodeFS.existsSync(tree)) {
      try {
        NodeChildProcess.execFileSync("git", ["worktree", "remove", "--force", tree], {
          stdio: ["ignore", 2, 2],
        });
      } catch {
        // The rmSync below still has to run: a remove that throws out of the
        // finally used to leak the root it was about to delete.
      }
    }
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
}

/** One `--allow` entry. An empty `names` means the whole file is allowed. */
interface Allowance {
  readonly reason: string;
  readonly names: Set<string>;
}

function parseArgs(argv: ReadonlyArray<string>) {
  let base = "origin/main";
  let showNames = false;
  const allow = new Map<string, Allowance>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base") {
      const value = argv[++index];
      // NOT `?? base`. A truncated command measured against origin/main and said
      // nothing, so the author read a table for a ref they did not ask for.
      if (value === undefined) {
        throw new CannotMeasure("--base needs a ref");
      }
      base = value;
    } else if (arg === "--names") {
      showNames = true;
    } else if (arg === "--allow") {
      const pair = argv[++index] ?? "";
      const eq = pair.indexOf("=");
      if (eq === -1) {
        throw new CannotMeasure(`--allow needs path[#test name]=reason, got: ${pair}`);
      }
      const target = pair.slice(0, eq);
      const reason = pair.slice(eq + 1).trim();
      // AN EMPTY REASON DEFEATS THE POINT. The reason exists to land in the PR
      // body; `--allow path=` waved a deleted test through on an argument that
      // explained nothing, and printed `ALLOWED <path>:` with nothing after the
      // colon.
      if (reason === "") {
        throw new CannotMeasure(`--allow needs a reason, got an empty one for: ${target}`);
      }
      const hash = target.indexOf("#");
      const path = hash === -1 ? target : target.slice(0, hash);
      const existing = allow.get(path);
      const names = existing?.names ?? new Set<string>();
      if (hash !== -1) names.add(target.slice(hash + 1));
      allow.set(path, { reason: existing?.reason ?? reason, names });
    } else {
      // The chain had no terminal else, so `--allowed`, `--nmes` and `--bse`
      // were accepted in silence. That fails in the dangerous direction twice: a
      // mistyped `--allow` means the author BELIEVES the decrease is explained
      // and the gate then fails saying nothing explained it, and a mistyped
      // `--base` measures against the default ref and prints a green table for a
      // comparison nobody asked for.
      throw new CannotMeasure(`unknown option '${arg}'. See the Usage block in this file.`);
    }
  }
  return { base, showNames, allow };
}

export interface Row {
  readonly path: string;
  readonly before: number;
  readonly after: number;
  readonly lost: ReadonlyArray<string>;
}

/**
 * The decision, separated from the running so it can be tested.
 *
 * A GATE THAT IS ITSELF UNTESTED IS THE THING IT EXISTS TO PREVENT. Everything
 * above shells out and takes minutes; this is pure, and its tests drive the
 * cases that matter — a deletion, an addition, and the one a count cannot see.
 */
export function compare(base: Suite, head: Suite): ReadonlyArray<Row> {
  const paths = [...new Set([...base.keys(), ...head.keys()])].sort();
  const rows: Array<Row> = [];
  for (const path of paths) {
    const before = base.get(path)?.names ?? [];
    const after = head.get(path)?.names ?? [];
    if (before.length === 0 && after.length === 0) continue;
    // NAMES THAT VANISHED, even when the count went UP. A split that drops one
    // of three properties and adds two tests is a net gain by count and a loss
    // by name, and by count alone it is invisible — which is how it got through
    // once already.
    //
    // A MULTISET, NOT A SET, and the difference is a real hole a set leaves: two
    // tests can share a `fullName`, and with set membership a surviving twin
    // masks a deleted one. Measured on the set version: base ["a","a","b"] to
    // head ["a","b","c"] reported 3 -> 3, lost nothing, printed no row at all,
    // and passed — a deleted proof, invisible to both halves of the check. The
    // count clause was the only thing that could have caught it and it was
    // inert against every test in the file.
    const remaining = new Map<string, number>();
    for (const name of after) remaining.set(name, (remaining.get(name) ?? 0) + 1);
    const lost: Array<string> = [];
    for (const name of before) {
      const left = remaining.get(name) ?? 0;
      if (left === 0) {
        lost.push(name);
        continue;
      }
      remaining.set(name, left - 1);
    }
    rows.push({ path, before: before.length, after: after.length, lost });
  }
  return rows;
}

/**
 * The row lost a NAME. That is the whole test, and the count is not consulted.
 *
 * IT USED TO READ `row.after < row.before || row.lost.length > 0`, and a QA lane
 * measured the first clause INERT: deleting it left all six tests green. Once
 * `lost` is a multiset difference the clause cannot change an outcome at all —
 * if the count fell, some name in base went unmatched, so `lost` is non-empty by
 * construction. A clause no input can red is dead logic, and dead logic in a
 * gate is worse than none: it reads as a second line of defence that is not
 * there. The count still appears in the table, because a reader wants to see it.
 *
 * IF `lost` EVER STOPS BEING A MULTISET DIFFERENCE the clause has to come back,
 * because that is the assumption doing the work here.
 *
 * WHETHER ANYTHING EXPLAINED IT IS THE CALLER'S, and this doc used to claim
 * otherwise — "nothing explained it" is a property of `main`'s allow filter, not
 * of a function that has never seen the allowlist. A second consumer reading the
 * old sentence would have used this alone and believed allowed decreases were
 * excluded from it.
 */
export const isRegression = (row: Row) => row.lost.length > 0;

function main(): number {
  const { base, showNames, allow } = parseArgs(process.argv.slice(2));

  // CWD MUST BE THE REPO ROOT. Head is keyed against the cwd and base against
  // the temp worktree root, so from a subdirectory the two key domains disagree
  // and every file reads as deleted-and-added. Failing with this sentence beats
  // printing a table that says the whole tree was deleted.
  const top = NodeChildProcess.execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  if (NodeFS.realpathSync(top) !== NodeFS.realpathSync(process.cwd())) {
    throw new CannotMeasure(`run this from the repo root (${top}), not ${process.cwd()}`);
  }

  const scope = describeScope(process.cwd());
  const head = runSuite(process.cwd());
  const baseSuite = withBaseWorktree(base, (cwd) => runSuite(cwd));
  const rows = compare(baseSuite, head);

  const width = Math.max(...rows.map((row) => row.path.length), 4);
  // SCOPE ON THE ARTIFACT ITSELF, so a table pasted into a PR body records what
  // it measured instead of implying the repo — including what it did NOT.
  write(
    `measured ${scope.measured.length} workspace(s) against ${base}: ${scope.measured.join(", ")}` +
      (TEST_TARGET === "" ? "" : ` [narrowed by '${TEST_TARGET}']`),
  );
  if (scope.skipped.length > 0) {
    write(`skipped, no \`test\` script: ${scope.skipped.join(", ")}`);
  }
  write(`${"file".padEnd(width)}  base  head`);
  for (const row of rows) {
    if (row.before === row.after && row.lost.length === 0) continue;
    write(
      `${row.path.padEnd(width)}  ${String(row.before).padStart(4)}  ${String(row.after).padStart(4)}`,
    );
    if (showNames) {
      for (const name of row.lost) write(`${" ".repeat(width)}    - ${name}`);
    }
  }

  // AN ALLOW THAT MATCHES NOTHING IS A TYPO, and silently it is a no-op that
  // reads as a pass.
  for (const path of allow.keys()) {
    if (!rows.some((row) => row.path === path)) {
      throw new CannotMeasure(`--allow names ${path}, which is not in the comparison`);
    }
  }

  /**
   * Explained means explained BY NAME wherever names were given.
   *
   * The allowlist's unit used to be the file while the rule's unit is the
   * decrease, so one explained deletion allowed every other loss in that file —
   * measured: a file losing a deliberate test and an accidental one, with only
   * the deliberate one named, exited 0 and never mentioned the accidental one.
   */
  const unexplained = (row: Row): boolean => {
    if (!isRegression(row)) return false;
    const allowance = allow.get(row.path);
    if (allowance === undefined) return true;
    if (allowance.names.size === 0) return false;
    if (row.lost.some((name) => !allowance.names.has(name))) return true;
    return row.after < row.before - allowance.names.size;
  };

  const failures = rows.filter(unexplained);
  const allowed = rows.filter((r) => allow.has(r.path) && isRegression(r) && !unexplained(r));
  for (const row of allowed) {
    write(`ALLOWED  ${row.path}: ${allow.get(row.path)?.reason ?? ""}`);
    // UNCONDITIONALLY, not behind --names: an ALLOWED line that does not say
    // what was lost is an author asserting a reason over an unnamed hole.
    for (const name of row.lost) write(`${" ".repeat(width)}    - ${name}`);
  }
  if (failures.length === 0) {
    const lostUnderAllow = allowed.reduce((total, row) => total + row.lost.length, 0);
    // TELLING THE TRUTH ABOUT WHAT IT ALLOWED. This line used to end "and no
    // test name lost" unconditionally, so a run that had just printed `- a3` as
    // lost went on to say no name was lost — and this is the line the PM reads
    // before merging.
    write(
      `\nMeasured ${scope.measured.length} workspace(s) against ${base}: ` +
        (lostUnderAllow === 0
          ? "no test lost by count or by name."
          : `${lostUnderAllow} lost name(s), each explained by --allow above.`),
    );
    write(
      "This does not see a test REWRITTEN UNDER THE SAME NAME — diff the test files, and re-run\n" +
        "the previous PR's mutants on any file you changed. A green gate is not the Tests rule\n" +
        "discharged.",
    );
    return 0;
  }
  writeErr("\nTest coverage went DOWN and nothing explained it:");
  for (const row of failures) {
    writeErr(`  ${row.path}: ${row.before} -> ${row.after}`);
    for (const name of row.lost) writeErr(`      lost: ${name}`);
  }
  writeErr(
    "\nName the decrease in the PR body with its reason and pass --allow <path>=<reason>,\n" +
      "or restore what went missing. Re-run the previous PR's mutants on that file either way:\n" +
      "a green suite says nothing about a proof that was deleted.",
  );
  return 1;
}

// Only when invoked, so the test can import `compare` without running a suite.
//
// `import.meta.main`, which is what every other guarded script in this directory
// uses. Matching on the FILENAME meant the gate silently exited 0 under any
// other name — measured by copying it to `test-coverage-gate.ts` — and "passes
// everything, says nothing" is the worst failure mode a gate has.
//
// `process.exitCode`, not `process.exit`: exiting immediately after writing can
// truncate the table when stdout is a pipe, and `pnpm test:count-gate | tee`
// is the reading this tool is built for. A truncated table under-reports.
if (import.meta.main) {
  try {
    process.exitCode = main();
  } catch (error) {
    writeErr(
      `\nCOULD NOT MEASURE: ${error instanceof Error ? error.message : String(error)}\n` +
        "This is exit 2, not a coverage regression. Nothing was compared.",
    );
    process.exitCode = 2;
  }
}
