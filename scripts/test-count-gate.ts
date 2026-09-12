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
 * WHAT IT MEASURES: every workspace that declares a `test` script, running that
 * script — the workspace's own, not one this file invents. Two exclusions, both
 * named on every run rather than implied: a workspace with no `test` script, and
 * one listed in `UNMEASURABLE_IN_COLD_TREE`. A narrowed run says so in the first
 * line of its own table, so a table pasted into a PR body cannot read as a full
 * run.
 *
 * `TEST_COUNT_GATE_TARGET` SELECTS WORKSPACES — it is matched against a
 * workspace's package name and its directory. It was "a filter passed to the
 * runner" under the root-project model this file replaced, and this sentence
 * still said so a hundred lines above the constant that contradicted it, which
 * is the first thing a reader meets.
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
 *   2  COULD NOT MEASURE — and the list is meant to stay exhaustive, so add to
 *      it when you add a refusal: no workspace list, a selection matching no
 *      workspace, a workspace that produced no report, a workspace that declares
 *      a `test` script and then measures nothing, a test file that fails to load
 *      in either revision, a base ref that will not check out (a shallow CI
 *      clone does this), an `--allow` that matches nothing, a stale entry in
 *      `UNMEASURABLE_IN_COLD_TREE`, and — the one an author actually meets —
 *      THE PR'S DIFF TOUCHING A WORKSPACE THE GATE SKIPS.
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
 * so `apps/server` and `server` both select the server.
 *
 * NARROW BY DIRECTORY. `t3` looks like the server's package name and selects
 * THIRTEEN of the fourteen workspaces, because every scoped package here begins
 * `@t3tools/` — measured, after this docstring offered it as a narrowing
 * example and would have handed the reader a full run. Narrowing is
 * printed in the table's first line, so a narrowed run cannot be pasted into a
 * PR body as a full one.
 *
 * IT USED TO BE A RUNNER FILTER FOR ONE ROOT-PROJECT RUN, and that is the bug
 * this file was rewritten for (`t3_bot-x4v`): see `listWorkspaces`.
 */
const TEST_TARGET = process.env["TEST_COUNT_GATE_TARGET"] ?? "";

/**
 * Workspaces that cannot be measured in a COLD BASE TREE, with the reason.
 *
 * DECLARED, NOT DISCOVERED. The gate could notice a base-side load failure and
 * skip that workspace by itself, and that would be the fail-open this whole
 * file exists to prevent: a real deletion inside a workspace that happened to
 * break would vanish into the same silence. An exception a human wrote down,
 * printed on every run, is the only honest kind.
 *
 * MEASURED, not assumed: `@t3tools/desktop` runs 1260 tests in a working tree
 * and fails to LOAD `src/backend/DesktopBackendConfiguration.test.ts` in a fresh
 * checkout of the base with its own `pnpm install --frozen-lockfile`. Something
 * that tree needs is not produced by the install; WHICH thing is `t3_bot-wjt`,
 * and until that is proven this is an observation rather than a diagnosis.
 *
 * THE SKIP IS NOT A LICENCE. If the PR's own diff touches a skipped workspace,
 * the gate exits 2 rather than skipping it: scope you changed is scope you have
 * to measure, and the author prepares that tree by hand for that PR.
 */
const UNMEASURABLE_IN_COLD_TREE: Readonly<Record<string, string>> = {
  "@t3tools/desktop":
    "fails to load src/backend/DesktopBackendConfiguration.test.ts in a cold base checkout " +
    "(runs 1260 tests in a prepared tree) — t3_bot-wjt",
};

/**
 * Whether this workspace is declared unmeasurable, by its OWN key.
 *
 * `Object.hasOwn`, not a bare index: `UNMEASURABLE_IN_COLD_TREE["toString"]`
 * resolves to a function through the prototype, so a workspace named
 * `constructor`, `toString`, `valueOf` or `hasOwnProperty` — all valid npm
 * package names, all arriving here from a manifest — classified as unmeasurable
 * and was silently never measured. Executed by a contracts lane. Silent
 * under-measurement is the one failure this instrument exists to refuse.
 */
const isUnmeasurable = (name: string) => Object.hasOwn(UNMEASURABLE_IN_COLD_TREE, name);

/** One workspace, as the package manager reports it. */
export interface Workspace {
  readonly name: string;
  /** Absolute, from the package manager — never from walking directories. */
  readonly path: string;
  /** Its own `test` script, or undefined when it declares none. */
  readonly testScript: string | undefined;
}

/**
 * The JSON array in a package manager's stdout, or undefined.
 *
 * NOT `indexOf("[")`. That was the tolerance #26 was supposed to have removed
 * and #28 claimed to have removed — a history lane read the diff and found it
 * moved here instead, still over a pnpm stdout, and `[` is the first character
 * of `[WARN] Unsupported engine…`, the exact token the claim quoted as the
 * breaking input.
 *
 * THE DISCRIMINATOR IS THE CHARACTER AFTER THE BRACKET. A JSON array opens with
 * `[` followed by whitespace, `{` or `]`; `[WARN]` is followed by a letter.
 *
 * FROM THAT LINE ONWARD, not that line. The payload is pretty-printed across
 * many lines, and the first version of this fix returned the single matching
 * line — `[` — so every real run refused with "was not JSON". The suite caught
 * it within a minute, which is the argument for this being an exported seam
 * rather than an expression buried in a function that shells out.
 */
export function jsonArrayPayload(stdout: string): string | undefined {
  const lines = stdout.split("\n");
  const start = lines.findIndex((line) => /^\s*\[\s*(\{|\]|$)/.test(line));
  return start === -1 ? undefined : lines.slice(start).join("\n");
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
  // THE LAST LINE THAT STARTS A JSON ARRAY, not the first `[` anywhere.
  //
  // I claimed in #28's body that reading reports from a file "removes the class
  // instead of widening a tolerance". A history lane read the diff: the
  // tolerance was MOVED, not removed. This parse still reads a pnpm child's
  // stdout, and `indexOf("[")` finds the `[` of `[WARN] Unsupported engine…` —
  // the exact token I quoted as the breaking input. `pnpm ls` happens to emit
  // clean JSON today, so it was latent rather than live; the fix is not to
  // widen the tolerance again but to anchor on a line boundary and to REFUSE
  // rather than throw an uncaught SyntaxError, which is what the exit-code
  // contract promises.
  const stdout = result.stdout ?? "";
  const payload = jsonArrayPayload(stdout);
  if (payload === undefined) {
    throw new CannotMeasure(
      `could not list the workspaces in ${repoRoot}. Without them there is nothing to measure, ` +
        `and measuring nothing must not report a pass.\n` +
        (result.stderr ?? "").slice(-2000),
    );
  }
  let listed: ReadonlyArray<{ readonly name?: string; readonly path?: string }>;
  try {
    listed = JSON.parse(payload) as ReadonlyArray<{
      readonly name?: string;
      readonly path?: string;
    }>;
  } catch (error) {
    throw new CannotMeasure(
      `the workspace list in ${repoRoot} was not JSON: ` +
        `${error instanceof Error ? error.message : String(error)}. A gate that cannot read the ` +
        `workspace list must refuse, not crash.`,
    );
  }
  const realRoot = NodeFS.realpathSync(repoRoot);
  const workspaces: Array<Workspace> = [];
  for (const entry of listed) {
    // A WORKSPACE THE GATE CANNOT NAME IS A REFUSAL, NOT A `continue`.
    //
    // Dropped here, such an entry landed in NO bucket — not measured, not
    // skipped, not printed — so its tests could be deleted for ever and the
    // gate would exit 0. A bug lane built one (`pnpm ls` does list a package
    // with a path and no name) and proved the scope identity assertion is
    // structurally blind to it: both sides of `measured + skipped +
    // unmeasurable === listed.length` are computed from this already-filtered
    // list, so the equation balances over a workspace neither side ever saw.
    if (entry.path === undefined) {
      throw new CannotMeasure(
        `the package manager listed a workspace with no path in ${repoRoot}; the gate cannot ` +
          `measure what it cannot locate.`,
      );
    }
    if (entry.name === undefined) {
      throw new CannotMeasure(
        `the package manager listed a workspace at ${entry.path} with no \`name\`. The gate ` +
          `addresses workspaces by name (\`pnpm --filter <name>\`), so it can neither measure ` +
          `this one nor honestly print it as skipped. Give the package a name.`,
      );
    }
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
  // No `target === ""` arm: `includes("")` is true for every string, so the
  // empty target already selects everything. A QA lane proved the arm
  // unkillable, and this file condemns clauses no input can red.
  workspace.name.includes(target) || NodePath.relative(repoRoot, workspace.path).includes(target);

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
  // THIS RUN'S REPORT, NOT A PREVIOUS ONE'S. The filename is a lossy
  // sanitisation of the package name, so two names can collapse onto one file —
  // and `existsSync` was then satisfied by the earlier workspace's report when
  // this one's run failed and wrote nothing. A bug lane executed that: the
  // failed run returned the other workspace's suite verbatim. Removing the file
  // first turns any collision into the honest refusal below.
  NodeFS.rmSync(outputFile, { force: true });
  const result = NodeChildProcess.spawnSync(
    "pnpm",
    ["--filter", workspace.name, "run", "test", "--reporter=json", `--outputFile=${outputFile}`],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      // THE TARGET DOES NOT TRAVEL INTO THE CHILD. The workspace is already
      // chosen by `--filter`, and leaving the variable set made the gate's own
      // suite red under a narrowed run: a test in `@t3tools/scripts` reads the
      // same variable and narrowed itself. A red suite under a green gate.
      env: { ...process.env, TEST_COUNT_GATE_TARGET: undefined },
    },
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
  // THE WORKSPACE *AND* THE TREE. Naming only the workspace cost a
  // reproduction: the same workspace passes in one revision and fails to load
  // in the other, and "failed to load in @t3tools/desktop" does not say which
  // side to go and look at.
  return toSuite(parsed, repoRoot, `${workspace.name} in ${repoRoot}`);
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
export function describeScope(repoRoot: string, target: string = TEST_TARGET) {
  const listed = listWorkspaces(repoRoot);
  // A STALE EXCEPTION IS NOT AN EXCEPTION. The map is only ever consulted BY an
  // existing workspace's name, so an entry naming a workspace that was renamed
  // or deleted is never read: no warning, no line in the table, and its reason —
  // with its measured evidence and its bead — sits in the file describing
  // nothing, for the next reader to trust. Exit 2 is the honest answer to "the
  // gate's own configuration no longer describes this repo".
  const dead = Object.keys(UNMEASURABLE_IN_COLD_TREE).filter(
    (name) => !listed.some((workspace) => workspace.name === name),
  );
  if (dead.length > 0) {
    throw new CannotMeasure(
      `${dead.join(", ")} is named in UNMEASURABLE_IN_COLD_TREE and is not a workspace in ` +
        `${repoRoot}. Remove the entry or fix the name: an exception nobody can point at is ` +
        `evidence for a claim about nothing.`,
    );
  }
  return splitScope(listed.filter((workspace) => selectsWorkspace(target, workspace, repoRoot)));
}

/**
 * Which of these will be measured, and which skipped for having no `test`.
 *
 * PURE, because the version that read the repo could not be told apart from one
 * that called every workspace measured: a test asserting the split was
 * "consistent" passed against `measured: all, skipped: []`, since with nothing
 * skipped there is nothing to contradict. Consistency was never the property.
 * The property is that a workspace WITHOUT a `test` script lands on the skipped
 * side, and saying so needs a workspace without one — which a fixture has and
 * this repo might not, a year from now.
 */
export const splitScope = (workspaces: ReadonlyArray<Workspace>) => ({
  measured: workspaces
    .filter((w) => w.testScript !== undefined && !isUnmeasurable(w.name))
    .map((w) => w.name),
  skipped: workspaces.filter((w) => w.testScript === undefined).map((w) => w.name),
  unmeasurable: workspaces
    .filter((w) => w.testScript !== undefined && isUnmeasurable(w.name))
    .map((w) => w.name),
});

/**
 * The skipped workspaces this diff touches, which the gate must refuse to skip.
 *
 * PURE, and both directions are tested: a PR that touches only `apps/server`
 * while `apps/desktop` is skipped measures fine, and a PR that touches
 * `apps/desktop` while it is skipped is a refusal. A skip is acceptable scope
 * only while the PR did not change it.
 */
export const skippedWorkspacesTouched = (
  changedPaths: ReadonlyArray<string>,
  skipped: ReadonlyArray<Workspace>,
  repoRoot: string,
): ReadonlyArray<string> => {
  const touched = new Set<string>();
  for (const workspace of skipped) {
    const prefix = `${NodePath.relative(repoRoot, workspace.path)}/`;
    for (const changed of changedPaths) {
      if (changed.startsWith(prefix)) touched.add(workspace.name);
    }
  }
  return [...touched];
};

/**
 * The files this PR changed, from git rather than from the working tree.
 *
 * `--no-renames`, AND IT IS THE WHOLE FINDING. Git detects renames by default and
 * `--name-only` then prints ONE path for the pair: the DESTINATION. So moving a
 * test file OUT of a skipped workspace — `git mv apps/desktop/x.test.ts
 * apps/server/x.test.ts` — produced a changed-path list that never named
 * `apps/desktop`, the touched-skipped refusal never fired, and the gate went
 * green over a PR that removed test files from a workspace it refuses to
 * measure. A contracts lane executed that in a throwaway repo. A plain deletion
 * was never affected; the hole was specifically "move them out", which is the
 * deletion-shaped edit an author is most likely to make.
 *
 * THE DOMAIN, stated because the obligation is only as total as its input:
 * COMMITTED HISTORY ONLY. `base...HEAD` does not see uncommitted work, while the
 * head suite measures the working tree — so the two halves of this gate disagree
 * about what "this PR" means for a dirty tree. The gate assumes the branch is
 * committed, which is what the merge flow requires anyway (unpushed work is
 * invisible to the PM). Covering a dirty tree is a second ref and a decision,
 * not a patch.
 */
export function changedPaths(repoRoot: string, base: string): ReadonlyArray<string> {
  const result = NodeChildProcess.spawnSync(
    "git",
    ["diff", "-z", "--name-only", "--no-renames", `${base}...HEAD`],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new CannotMeasure(
      `could not diff ${base}...HEAD in ${repoRoot}, so the gate cannot tell whether this PR ` +
        `touched a skipped workspace.\n` +
        (result.stderr ?? "").slice(-2000),
    );
  }
  // `-z`, SO THE PATHS ARE THE PATHS. Without it git C-quotes any path with a
  // byte outside ASCII — `"apps/desktop/src/Caf\303\251.test.ts"`, leading
  // quote included — and the prefix comparison against `apps/desktop/` is then
  // false, so a PR whose only change inside a skipped workspace has a non-ASCII
  // filename walks past the refusal. A bug lane executed it. `-z` also removes
  // the newline-in-filename case that splitting on "\n" mis-splits.
  return (result.stdout ?? "").split("\0").filter((line) => line !== "");
}

/**
 * The workspaces `runSuite` will actually RUN, in order.
 *
 * THE PRINTED SCOPE AND THE EXECUTED SCOPE MUST BE THE SAME SET, and nothing
 * said so: `splitScope` decides what the table claims and `runSuite`'s two
 * `continue`s decide what runs, and a QA lane deleted either one with all
 * twenty tests still green. The drift that matters is the quiet direction —
 * `splitScope` reporting a workspace as measured while `runSuite` skips it, so
 * the table claims coverage nobody ran.
 */
export const workspacesToRun = (workspaces: ReadonlyArray<Workspace>): ReadonlyArray<Workspace> =>
  workspaces.filter((w) => w.testScript !== undefined && !isUnmeasurable(w.name));

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
    // ONE PREDICATE FOR WHAT RUNS, shared with what the scope line prints. A
    // workspace with no `test` script, and one declared unmeasurable in a cold
    // tree, are both skipped AND SAID — skipping is scope, and unprinted scope
    // is the thing this gate exists to stop. `main` has already refused if the
    // diff touches an unmeasurable one, so reaching here means the PR did not.
    for (const workspace of workspacesToRun(selected)) {
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
export function toSuite(parsed: RunnerReport, cwd: string, measuring: string): Suite {
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
        `${relative} failed to load in ${measuring}, so its tests were never counted. ` +
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
  if (suite.size === 0) {
    throw new CannotMeasure(
      `${measuring} reported no test files. A workspace that declares a \`test\` script and then ` +
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

  // SCOPE YOU CHANGED IS SCOPE YOU HAVE TO MEASURE. A workspace skipped for
  // being unmeasurable in a cold tree is acceptable only while the PR did not
  // touch it; the moment it did, "could not measure" is the true answer.
  // THE SAME PREDICATE `splitScope` USES, and the same one `runSuite` skips on.
  // It was map-membership here and "has a test script AND is in the map" there,
  // so a declared workspace that dropped its `test` script was refused-when-
  // touched by this line while the scope line filed it under "no test script"
  // and never printed its declared reason.
  const skippedWorkspaces = listWorkspaces(process.cwd()).filter((workspace) =>
    isUnmeasurable(workspace.name),
  );
  const touched = skippedWorkspacesTouched(
    changedPaths(process.cwd(), base),
    skippedWorkspaces,
    process.cwd(),
  );
  if (touched.length > 0) {
    throw new CannotMeasure(
      `this PR changes ${touched.join(", ")}, which the gate skips as unmeasurable in a cold ` +
        `base tree. A skipped workspace is acceptable scope only while the PR did not change it. ` +
        `Prepare that workspace's base tree by hand and measure it for this PR.`,
    );
  }

  const head = runSuite(process.cwd());
  const baseSuite = withBaseWorktree(base, (cwd) => runSuite(cwd));
  const rows = compare(baseSuite, head);

  const width = Math.max(...rows.map((row) => row.path.length), 4);
  // SCOPE ON THE ARTIFACT ITSELF, so a table pasted into a PR body records what
  // it measured instead of implying the repo — including what it did NOT.
  // ONE EXPRESSION, USED ON BOTH LINES. The narrowing marker was on the first
  // line only, and the CLOSING line is the verdict a reader quotes — so the one
  // sentence most likely to be pasted could not be told apart from a full run.
  // `TEST_COUNT_GATE_TARGET` is an environment variable, so it leaves no trace
  // in the command either.
  const narrowing = TEST_TARGET === "" ? "" : ` [narrowed by '${TEST_TARGET}']`;
  write(
    `measured ${scope.measured.length} workspace(s) against ${base}: ${scope.measured.join(", ")}` +
      narrowing,
  );
  if (scope.skipped.length > 0) {
    write(`skipped, no \`test\` script: ${scope.skipped.join(", ")}`);
  }
  for (const name of scope.unmeasurable) {
    write(
      `SKIPPED, unmeasurable in a cold base tree: ${name} — ${UNMEASURABLE_IN_COLD_TREE[name]}`,
    );
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
      `\nMeasured ${scope.measured.length} workspace(s) against ${base}${narrowing}: ` +
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
  writeErr(`\nTest coverage went DOWN and nothing explained it${narrowing}:`);
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
