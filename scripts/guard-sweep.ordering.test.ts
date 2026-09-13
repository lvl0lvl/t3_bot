/**
 * ONE CLAIM, AND IT IS ABOUT ORDER: the pre-flight refuses before the suite is spawned.
 *
 * Separate from `guard-sweep.test.ts`, which opens by saying "Nothing here spawns a
 * process or touches git" and is right to — the pure core is where wrong answers have
 * come from, it runs in milliseconds, and folding a temp-directory git repo into it would
 * make that sentence false.
 *
 * THE SUITE IS A STUB, AND THAT IS THE WHOLE TRICK. `testCommand` is a config field and
 * the tool appends `--reporter=json`, which a shell script receives harmlessly as `$0`.
 * So a script that appends one line per spawn to a log and echoes a synthetic report IS a
 * suite, and whether the baseline ran becomes a POSITIVE MEASUREMENT of the spawn rather
 * than an inference from a log line's absence. The author of the pre-flight believed the
 * ordering was unpinnable for want of an injection point; the injection point was in the
 * config all along, and a review lane said so.
 *
 * THE SPAWN COUNT IS THE ASSERTION, not the exit code and not the error tag. With the
 * pre-flight placed AFTER the baseline the tag is still `GuardSweepConfigError` and the
 * exit is still 1 — so a test asserting either would pass against the one placement this
 * change exists to rule out. Only the count of spawns tells them apart.
 */
import { describe, expect, it } from "vite-plus/test";

// @effect-diagnostics nodeBuiltinImport:off - drives the sweep as a subprocess against a
// stub suite; the subject is the tool's ordering, not an Effect service.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const SUITE = [
  "#!/bin/sh",
  'echo spawn >> "$(dirname "$0")/spawns.log"',
  // A report the tool's own reader accepts: it scans for `{"numTotalTestSuites"`.
  `echo '{"numTotalTestSuites":1,"numTotalTests":1,"testResults":[{"name":"a.test.ts","assertionResults":[{"fullName":"a passes","status":"passed"}]}]}'`,
  "",
].join("\n");

const SOURCE = "a\nif (guard) {\nb\n";

/** A one-file git repo whose suite is a stub, and a config pointing one row at `anchor`. */
const scaffold = (anchor: string) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "guard-sweep-ordering-"));
  const suite = NodePath.join(root, "suite.sh");
  NodeFS.writeFileSync(suite, SUITE, { mode: 0o755 });
  NodeFS.mkdirSync(NodePath.join(root, "src"));
  NodeFS.writeFileSync(NodePath.join(root, "src/thing.ts"), SOURCE);
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
      mutations: [
        {
          id: "the-row",
          guard: "theGuard",
          axis: "inert",
          file: "src/thing.ts",
          find: anchor,
          replace: "if (false) {",
        },
      ],
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

describe("the pre-flight refuses before the suite is spawned", () => {
  it("does not spawn the suite when an anchor is stale", () => {
    const { root, config, log } = scaffold("if (this anchor is not in the file) {");
    try {
      const done = runSweep(root, config);
      expect(done.status).not.toBe(0);
      expect(`${done.stdout}${done.stderr}`).toContain("GuardSweepConfigError");
      // THE DISCRIMINATING ASSERTION. A pre-flight placed after the baseline produces the
      // same status and the same tag, and would pass every line above this one.
      expect(spawnsIn(log)).toBe(0);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("does spawn the suite when every anchor resolves", () => {
    // THE OTHER DIRECTION, so the test above cannot be satisfied by a tool that refuses
    // every config it is given.
    const { root, config, log } = scaffold("if (guard) {");
    try {
      runSweep(root, config);
      expect(spawnsIn(log)).toBeGreaterThan(0);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
