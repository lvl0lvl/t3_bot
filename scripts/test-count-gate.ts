// @effect-diagnostics nodeBuiltinImport:off - a CLI gate that shells out and reads files.
/**
 * Per-file test counts, base against head, FROM THE RUNNER.
 *
 * CLAUDE.md's Tests rule says a test count may not go down silently. Until this
 * script existed the comparison was prose: the author measured by hand, wrote a
 * table in the PR body, and the PM read it. That is a gate made of remembering,
 * and #21's history lane pointed out that the rule named a mechanism nobody had
 * built.
 *
 * WHY THE RUNNER AND NOT A GREP. `grep -c "it("` counts strings, comments and
 * the word inside `commit(`; it also cannot see a skipped test, a `describe`
 * that returns early, or a file that fails to load — all of which are decreases
 * a reader would want to know about. The runner reports what it EXECUTED, which
 * is the number the rule is about. CLAUDE.md now says so explicitly, after an
 * author (me) wrote grep-derived counts into two PR bodies.
 *
 * WHAT THIS CANNOT SEE, and it is the failure that prompted the rule, so it is
 * stated first rather than in a footnote: AN ASSERTION REMOVED FROM INSIDE A
 * TEST THAT STILL EXISTS. On 2026-09-12 a test of mine was split into three and
 * its fourth property was dropped; the count went UP, and the guard that
 * property protected sat inert in the tree for six hours. A count gate is a
 * floor, not a proof. It catches deletion and renaming-away; it does not catch
 * hollowing out. `git diff` over the test file is still the check for that, and
 * `--names` below is the closest this tool gets.
 *
 * Usage:
 *   node scripts/test-count-gate.ts --base origin/main [--allow path=reason]...
 *   node scripts/test-count-gate.ts --base origin/main --names
 *
 * `--allow` takes a file path and a reason; a decrease in that file is then
 * reported but not fatal, and the reason is printed so it lands in the PR body
 * rather than in someone's memory.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/**
 * A table is a stream of lines, not a stream of events, so this writes to the
 * stream rather than through `Logger`. `resolve-previous-release-tag.ts` does
 * the same for the same reason: a structured logger would stamp every row with
 * a level and a time and make the output unreadable as a table.
 */
const write = (line: string) => process.stdout.write(`${line}\n`);
const writeErr = (line: string) => process.stderr.write(`${line}\n`);

export interface FileTests {
  /** Executed test names, in the order the runner reported them. */
  readonly names: ReadonlyArray<string>;
}

export type Suite = Map<string, FileTests>;

/**
 * What to measure. Overridable so a proof run can take seconds instead of
 * minutes; the gate itself runs the whole server suite.
 */
const TEST_TARGET = process.env["TEST_COUNT_GATE_TARGET"] ?? "apps/server";

/**
 * The runner's own account of what ran.
 *
 * `--reporter=json` prints a leading banner before the object on some versions,
 * so the payload starts at the first brace rather than at byte zero. Parsing
 * from there rather than trimming is what survives a banner changing.
 */
function runSuite(cwd: string): Suite {
  const result = NodeChildProcess.spawnSync(
    "./node_modules/.bin/vp",
    ["test", "run", TEST_TARGET, "--reporter=json"],
    { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const stdout = result.stdout ?? "";
  const start = stdout.indexOf("{");
  if (start === -1) {
    throw new Error(
      `no JSON from the runner in ${cwd}. A suite that cannot RUN is not a suite with zero tests, ` +
        `and reporting it as an empty map would turn a broken base into a clean pass.\n` +
        (result.stderr ?? "").slice(-2000),
    );
  }
  const parsed = JSON.parse(stdout.slice(start)) as {
    testResults?: ReadonlyArray<{
      name?: string;
      assertionResults?: ReadonlyArray<{ fullName?: string; title?: string; status?: string }>;
    }>;
  };
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
    const relative = NodePath.relative(realCwd, NodeFS.realpathSync(file.name));
    const names = (file.assertionResults ?? [])
      // SKIPPED IS A DECREASE. A test turned into `it.skip` still appears in the
      // report and would otherwise count as present, which is exactly the
      // silent loss the rule is about.
      .filter((test) => test.status === "passed" || test.status === "failed")
      .map((test) => test.fullName ?? test.title ?? "<unnamed>");
    suite.set(relative, { names });
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
  NodeChildProcess.execFileSync("git", ["worktree", "add", "--detach", tree, baseRef], {
    stdio: "inherit",
  });
  try {
    NodeChildProcess.execFileSync("pnpm", ["install", "--frozen-lockfile"], {
      cwd: tree,
      stdio: "inherit",
    });
    return use(tree);
  } finally {
    NodeChildProcess.execFileSync("git", ["worktree", "remove", "--force", tree], {
      stdio: "inherit",
    });
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
}

function parseArgs(argv: ReadonlyArray<string>) {
  let base = "origin/main";
  let showNames = false;
  const allow = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base") {
      base = argv[++index] ?? base;
    } else if (arg === "--names") {
      showNames = true;
    } else if (arg === "--allow") {
      const pair = argv[++index] ?? "";
      const eq = pair.indexOf("=");
      if (eq === -1) {
        throw new Error(`--allow needs path=reason, got: ${pair}`);
      }
      allow.set(pair.slice(0, eq), pair.slice(eq + 1));
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
    const remaining = new Set(after);
    const lost = before.filter((name) => !remaining.has(name));
    rows.push({ path, before: before.length, after: after.length, lost });
  }
  return rows;
}

/** A row is a failure if it lost ground and nothing explained it. */
export const isRegression = (row: Row) => row.after < row.before || row.lost.length > 0;

function main(): number {
  const { base, showNames, allow } = parseArgs(process.argv.slice(2));
  const head = runSuite(process.cwd());
  const baseSuite = withBaseWorktree(base, (cwd) => runSuite(cwd));
  const rows = compare(baseSuite, head);

  const width = Math.max(...rows.map((row) => row.path.length), 4);
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

  const failures = rows.filter((row) => isRegression(row) && !allow.has(row.path));
  for (const row of rows.filter((r) => allow.has(r.path) && isRegression(r))) {
    write(`ALLOWED  ${row.path}: ${allow.get(row.path)}`);
  }
  if (failures.length === 0) {
    write("\nNo unexplained decrease, and no test name lost.");
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
if (process.argv[1]?.endsWith("test-count-gate.ts") === true) {
  process.exit(main());
}
