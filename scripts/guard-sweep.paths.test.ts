/**
 * ONE CLAIM: a `file` git would print differently is refused before any lookup is keyed on it.
 *
 * The defect this pins produced a CONFIRMED FALSE KILL at exit 0 — the one verdict that gates a
 * merge. `moved` comes from `git status --porcelain`, which prints `src/thing.ts`, and five places
 * keyed on the raw config string, so a row spelled `./src/thing.ts` missed the setup-written guard,
 * was measured on a tree `setupCommand` had dirtied, and its restore (`git checkout --
 * ./src/thing.ts`) reverted setup's write rather than the mutation. A LATER row was then credited
 * with killing a test that reddened for that reason.
 *
 * THE END-TO-END TEST IS THE POINT, not the predicate. `nonNormalMutationPaths` is pure and unit
 * tested beside it, but a pure test cannot show that the refusal happens BEFORE the five keyed
 * lookups — and "the check exists" was never the question. So this drives the real tool against a
 * stub suite, and the assertion is that the suite is NEVER SPAWNED: with the refusal placed after
 * any of those lookups the exit code and the error tag are unchanged, so only the spawn count
 * tells the placements apart.
 *
 * Separate from `guard-sweep.test.ts`, which says "Nothing here spawns a process or touches git",
 * and from `guard-sweep.ordering.test.ts`, which pins a different refusal for a different reason.
 */
import { describe, expect, it } from "vite-plus/test";

// @effect-diagnostics nodeBuiltinImport:off - drives the sweep as a subprocess against a stub
// suite; the subject is the tool's own refusal, not an Effect service.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/**
 * Two assertions, and which one reds is what makes the two-row case a FALSE kill rather than a
 * miscount: `the guard is present` reds on row one's own mutation, `setup state is present` reds
 * only because a restore reverted setup's write. Both read the file in `$PWD`, the swept worktree —
 * reading the script's own directory instead would inspect the original tree, which `setupCommand`
 * never touches, and every run would then report the same thing.
 */
const SUITE = [
  "#!/bin/sh",
  'echo spawn >> "$(dirname "$0")/spawns.log"',
  'if grep -q "setup wrote this" "$PWD/src/thing.ts" 2>/dev/null; then S=passed; else S=failed; fi',
  'if grep -q "if (guard) {" "$PWD/src/thing.ts" 2>/dev/null; then G=passed; else G=failed; fi',
  `echo "{\\"numTotalTestSuites\\":1,\\"numTotalTests\\":2,\\"testResults\\":[{\\"name\\":\\"src/thing.test.ts\\",\\"assertionResults\\":[{\\"fullName\\":\\"setup state is present\\",\\"status\\":\\"$S\\"},{\\"fullName\\":\\"the guard is present\\",\\"status\\":\\"$G\\"}]}]}"`,
  "",
].join("\n");

const guardRow = (file: string) => ({
  id: "the-row",
  guard: "theGuard",
  axis: "inert",
  file,
  find: "if (guard) {",
  replace: "if (false) {",
});

/** A row in a DIFFERENT file, which is the row the defect credited with someone else's red. */
const elsewhereRow = {
  id: "row-two-elsewhere",
  guard: "limit",
  axis: "wider",
  file: "src/other.ts",
  find: "export const limit = 10;",
  replace: "export const limit = 1;",
};

/** `setupCommand` dirties `src/thing.ts`, which is the file every one of these rows turns on. */
const scaffold = (mutations: ReadonlyArray<unknown>) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "guard-sweep-paths-"));
  const suite = NodePath.join(root, "suite.sh");
  NodeFS.writeFileSync(suite, SUITE, { mode: 0o755 });
  NodeFS.mkdirSync(NodePath.join(root, "src"));
  NodeFS.writeFileSync(NodePath.join(root, "src/thing.ts"), "a\nif (guard) {\nb\n");
  NodeFS.writeFileSync(NodePath.join(root, "src/other.ts"), "export const limit = 10;\n");
  for (const argv of [
    ["init", "--quiet"],
    ["config", "user.email", "t@example.invalid"],
    ["config", "user.name", "t"],
    ["add", "-A"],
    ["commit", "--quiet", "-m", "seed"],
  ]) {
    const done = NodeChildProcess.spawnSync("git", argv, { cwd: root, encoding: "utf8" });
    if (done.status !== 0) {
      throw new Error(`git ${argv[0]} failed in the scaffold: ${done.stderr}`);
    }
  }
  const config = NodePath.join(root, "sweep.json");
  NodeFS.writeFileSync(
    config,
    JSON.stringify({
      testCommand: [suite],
      setupCommand: ["/bin/sh", "-c", "printf '// setup wrote this\\n' >> src/thing.ts"],
      mutations,
    }),
  );
  return { root, config, log: NodePath.join(root, "spawns.log") };
};

const spawnsIn = (log: string): number =>
  NodeFS.existsSync(log)
    ? NodeFS.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).length
    : 0;

const runSweep = (root: string, config: string) =>
  NodeChildProcess.spawnSync(
    process.execPath,
    [NodePath.join(import.meta.dirname, "guard-sweep.ts"), "--config", config, "--repo", root],
    { cwd: root, encoding: "utf8" },
  );

describe("a path git would print differently is refused", () => {
  for (const file of ["./src/thing.ts", "src/../src/thing.ts"]) {
    it(`refuses ${file} without spawning the suite`, () => {
      const { root, config, log } = scaffold([guardRow(file)]);
      try {
        const done = runSweep(root, config);
        const output = `${done.stdout}${done.stderr}`;
        expect(done.status).not.toBe(0);
        expect(output).toContain("GuardSweepConfigError");
        // NAMES THE ROW AND THE SPELLING, because the operator has to fix the config and the
        // only actionable thing is which row and what is wrong with it.
        expect(output).toContain("the-row");
        expect(output).toContain(file);
        // THE ASSERTION THAT PINS THE ORDER. This refusal must precede the five keyed lookups;
        // placed after any of them the status and the tag are identical, so nothing above this
        // line distinguishes the two.
        expect(spawnsIn(log)).toBe(0);
      } finally {
        NodeFS.rmSync(root, { recursive: true, force: true });
      }
    }, 60_000);
  }

  it("refuses the two-row config that exited 0 with a kill credited to the wrong row", () => {
    // THE INPUT THE DEFECT CAME FROM, which the single-row cases above cannot express: one bad
    // spelling only becomes a false CONFIRMATION when a later row is there to be credited.
    // Measured on this tool with the refusal removed: exit 0, the table calling both rows killed,
    // and `row-two-elsewhere` credited to `src/thing.test.ts > setup state is present` — a file
    // its own mutation (`src/other.ts`) never touches. It reddened because row one's restore
    // reverted setup's write. Exit 0 is the verdict that gates a merge, so that run reads green.
    const { root, config, log } = scaffold([guardRow("./src/thing.ts"), elsewhereRow]);
    try {
      const done = runSweep(root, config);
      const output = `${done.stdout}${done.stderr}`;
      expect(done.status).not.toBe(0);
      expect(output).toContain("GuardSweepConfigError");
      expect(output).toContain("the-row");
      // The row that is FINE is not named: an operator told two rows are wrong edits two.
      expect(output).not.toContain("row-two-elsewhere");
      expect(spawnsIn(log)).toBe(0);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("still sweeps the same file spelled as git prints it", () => {
    // THE CONTROL, and it is the half that keeps the refusal honest: the same file, the same
    // setupCommand, one spelling apart. Before this change this exited 3 with an accurate NOT RUN;
    // it must keep doing that rather than becoming a config refusal.
    const { root, config, log } = scaffold([guardRow("src/thing.ts")]);
    try {
      const done = runSweep(root, config);
      const output = `${done.stdout}${done.stderr}`;
      expect(output).not.toContain("GuardSweepConfigError");
      // setupCommand wrote to the row's own file, so the row is unmeasurable and says so.
      expect(output).toContain("the tree already differs from HEAD at src/thing.ts");
      expect(done.status).toBe(3);
      // And it got as far as measuring: the baseline ran.
      expect(spawnsIn(log)).toBeGreaterThan(0);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
