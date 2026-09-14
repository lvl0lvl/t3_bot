/**
 * ONE CLAIM: a mutation file that is a tracked symlink, or that resolves outside the tree, is
 * NOT RUN before anything is written through it.
 *
 * The defect this pins (`t3_bot-k1v`, found by #42's review) produced a CONFIRMED FALSE KILL at
 * exit 0. `readFileString`/`writeFileString` follow a link, so a row on `src/link.ts -> thing.ts`
 * mutated `thing.ts`; the restore, `git checkout -- src/link.ts`, returned the LINK to HEAD —
 * unchanged — and every later row was measured on the mutated target. On the two-row fixture
 * below, both rows were killed and the second was credited "the guard is present" for a red the
 * first row's leftover mutation caused. With an absolute-target link the mutation landed in a
 * file OUTSIDE the tree and stayed there after the run, which refusal 3 in the tool's header
 * ("it mutates only a tree it created") promises cannot happen.
 *
 * THE END-TO-END TEST IS THE POINT: the assertion is on the target's bytes after the run and on
 * the second row's verdict, not on the predicate. Separate from `guard-sweep.paths.test.ts`
 * (a spelling git prints differently) — a link is spelled exactly as porcelain prints it.
 */
import { describe, expect, it } from "vite-plus/test";

// @effect-diagnostics nodeBuiltinImport:off - drives the sweep as a subprocess against a stub
// suite; the subject is the tool's own refusal, not an Effect service.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/** One test, "the guard is present", read from `$PWD/src/thing.ts` — the swept worktree. */
const SUITE = [
  "#!/bin/sh",
  'if grep -q "if (guard) {" "$PWD/src/thing.ts" 2>/dev/null; then G=passed; else G=failed; fi',
  `echo "{\\"numTotalTestSuites\\":1,\\"numTotalTests\\":1,\\"testResults\\":[{\\"name\\":\\"src/thing.test.ts\\",\\"assertionResults\\":[{\\"fullName\\":\\"the guard is present\\",\\"status\\":\\"$G\\"}]}]}"`,
  "",
].join("\n");

const rowOn = (id: string, file: string) => ({
  id,
  guard: "theGuard",
  axis: "inert",
  file,
  find: "if (guard) {",
  replace: "if (false) {",
});

const git = (root: string, ...argv: ReadonlyArray<string>) => {
  const done = NodeChildProcess.spawnSync("git", argv, { cwd: root, encoding: "utf8" });
  if (done.status !== 0) {
    throw new Error(`git ${argv[0]} failed in the scaffold: ${done.stderr}`);
  }
  return done.stdout;
};

/**
 * `src/thing.ts` holds the guard; `src/link.ts` is a tracked symlink to it (index mode 120000);
 * `src/plain.ts` has no guard and `src/plainlink.ts` links to it; `outside.ts` lives in a sibling
 * temp directory and `src/outlink.ts` links to it by absolute path. Every link is committed, so
 * porcelain is clean and `ls-files --error-unmatch` passes. The config is written beside
 * `outside.ts`, not in the root: an untracked `sweep.json` in the root is the dirty tree an
 * `--in-place` sweep refuses (exit 1) before it reads a row.
 */
const scaffold = (mutations: ReadonlyArray<unknown>) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "guard-sweep-symlink-"));
  const elsewhere = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "guard-sweep-outside-"));
  const outside = NodePath.join(elsewhere, "outside.ts");
  NodeFS.writeFileSync(outside, "a\nif (guard) {\nb\n");
  NodeFS.writeFileSync(NodePath.join(root, "suite.sh"), SUITE, { mode: 0o755 });
  NodeFS.mkdirSync(NodePath.join(root, "src"));
  NodeFS.writeFileSync(NodePath.join(root, "src/thing.ts"), "a\nif (guard) {\nb\n");
  NodeFS.writeFileSync(NodePath.join(root, "src/plain.ts"), "no guard here\n");
  NodeFS.symlinkSync("thing.ts", NodePath.join(root, "src/link.ts"));
  NodeFS.symlinkSync("plain.ts", NodePath.join(root, "src/plainlink.ts"));
  NodeFS.symlinkSync(outside, NodePath.join(root, "src/outlink.ts"));
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "t@example.invalid");
  git(root, "config", "user.name", "t");
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "seed");
  const config = NodePath.join(elsewhere, "sweep.json");
  NodeFS.writeFileSync(
    config,
    JSON.stringify({ testCommand: [NodePath.join(root, "suite.sh")], mutations }),
  );
  return { root, config, outside };
};

const runSweep = (root: string, config: string, ...flags: ReadonlyArray<string>) =>
  NodeChildProcess.spawnSync(
    process.execPath,
    [
      NodePath.join(import.meta.dirname, "guard-sweep.ts"),
      "--config",
      config,
      "--repo",
      root,
      ...flags,
    ],
    { cwd: root, encoding: "utf8" },
  );

describe("a mutation file that is a symlink is not written through", () => {
  it("reports the link row NOT RUN and measures the row after it on an untouched target", () => {
    const { root, config } = scaffold([
      rowOn("through-the-link", "src/link.ts"),
      rowOn("on-the-target", "src/thing.ts"),
    ]);
    expect(git(root, "ls-files", "-s", "--", "src/link.ts").startsWith("120000 ")).toBe(true);

    // IN PLACE, so the bytes below are the tree the sweep wrote. Without `--in-place` the sweep
    // writes a worktree it removes, and `root/src/thing.ts` is byte-identical to HEAD with the
    // link gate deleted — the assertion on it pinned nothing.
    const done = runSweep(root, config, "--in-place");

    // THE FALSE KILL: before this refusal the first row's mutation landed in thing.ts and its
    // restore returned the link, so the link row was credited `killed by 1` for a red the
    // TARGET's mutation caused, and the second row was NOT RUN — anchor not found — because
    // that mutation was still in thing.ts when it was read: exit 3, a false kill beside an
    // unmeasured row. (The bead's run, with a `setupCommand`, went further: both rows killed,
    // exit 0.) Now the link row is NOT RUN, the target is byte-identical to HEAD when the
    // second row is measured, and only that row's own mutation reds the suite.
    expect(done.stdout).toContain("through-the-link: NOT RUN");
    expect(done.stdout).toContain("is a symlink in the index");
    expect(done.stdout).toContain("on-the-target: killed by 1");
    // With the link gate deleted this file holds `if (false) {` after the run.
    expect(NodeFS.readFileSync(NodePath.join(root, "src/thing.ts"), "utf8")).toBe(
      "a\nif (guard) {\nb\n",
    );
    expect(git(root, "status", "--porcelain")).toBe("");
    // NOT RUN outranks a kill at the exit: 3, not the 0 a dropped verdict gives nor the 1 a
    // crash after the report gives.
    expect(done.status).toBe(3);
  });

  it("names the link, not the anchor, when the link's target lacks the anchor", () => {
    const { root, config } = scaffold([rowOn("through-the-plainlink", "src/plainlink.ts")]);

    const done = runSweep(root, config);

    // THE PRE-FLIGHT reads every row's source to refuse a stale anchor before the baseline. Read
    // through this link it would find no anchor in plain.ts and refuse the WHOLE config, exit 1,
    // blaming the anchor — for a row whose defect is that its path is a link. The pre-flight
    // skips a link the way it skips an untracked or outside path, and the row loop names it.
    expect(done.stdout).not.toContain("could not be applied");
    expect(done.stdout).toContain("through-the-plainlink: NOT RUN");
    expect(done.stdout).toContain("is a symlink in the index");
    expect(done.status).toBe(3);
  });

  it("never writes to a file outside the tree that a link points at", () => {
    const { root, config, outside } = scaffold([rowOn("through-the-outlink", "src/outlink.ts")]);

    const done = runSweep(root, config);

    expect(done.stdout).toContain("through-the-outlink: NOT RUN");
    // The bytes the sweep must never have touched: an absolute-target link used to leave the
    // mutation in this file after the run, outside anything the tool created or restores.
    expect(NodeFS.readFileSync(outside, "utf8")).toBe("a\nif (guard) {\nb\n");
    expect(done.status).toBe(3);
  });
});
