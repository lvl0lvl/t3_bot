/**
 * TWO CLAIMS ABOUT THE CI STEP THAT RUNS THE SWEEP, both of which fail SILENTLY when broken.
 *
 * This bead (`t3_bot-2ij`) exists because on #68 the sweep's exit code had no reader: the tool
 * refused the whole config and exited 1, and the config sat inert for a day. Putting the sweep in
 * CI gives the exit code a reader — but only while the step still reports it, and only while the
 * matrix still covers every config. Both of those are one careless edit away, and neither edit
 * produces a red anywhere. Hence a test rather than a comment.
 *
 * CLAIM 1 — THE VERDICT IS NOT PIPED AWAY. GitHub runs a `run:` step under `bash -e {0}`, which
 * does NOT set `pipefail`, so `guard-sweep … | tee sweep.log` reports TEE's status: a sweep that
 * exited 1 goes GREEN. Measured, both shells:
 *     bash -e             -c 'false | tee /dev/null; echo $?'   ->  0
 *     bash -e -o pipefail -c 'false | tee /dev/null; echo $?'   ->  fails, correctly
 * That is the third instance of one class on this tool: qa29 read exit 0 off its own PIPESTATUS on
 * PR #29, a session read "completed (exit code 0)" off a harness wrapper on 2026-09-14, and this
 * would have been the same false green in CI — the one place where nobody re-reads the number.
 * A pipe buys nothing here: a run step's stdout is already the run log.
 *
 * CLAIM 2 — THE MATRIX COVERS EVERY CHECKED-IN CONFIG. A seventh config added to `scripts/` and not
 * added to the matrix is never swept, and nothing anywhere goes red — which is #68's failure
 * arriving by a new route, through the fix for it. The assertion is set equality in both
 * directions: an entry naming a config that does not exist fails loudly at run time, but a config
 * the matrix omits fails in no way at all, and that is the direction this test is for.
 */
import { describe, expect, it } from "vite-plus/test";

// @effect-diagnostics nodeBuiltinImport:off - the subject is a checked-in YAML file and the
// contents of scripts/, read from disk; there is no Effect service here to go through.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const REPO = NodePath.resolve(import.meta.dirname, "..");
const WORKFLOW = NodePath.join(REPO, ".github", "workflows", "fork-ci.yml");

const workflowText = () => NodeFS.readFileSync(WORKFLOW, "utf8");

/** The `run:` lines of the workflow that invoke the sweep, with comments excluded. */
const sweepRunLines = (text: string): ReadonlyArray<string> =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("#"))
    .filter((line) => line.includes("guard-sweep.ts"));

const checkedInConfigs = (): ReadonlyArray<string> =>
  NodeFS.readdirSync(NodePath.join(REPO, "scripts"))
    .filter((name) => /^guard-sweep\..+\.json$/.test(name))
    .map((name) => name.replace(/^guard-sweep\./, "").replace(/\.json$/, ""))
    .sort();

const matrixConfigs = (text: string): ReadonlyArray<string> => {
  const start = text.indexOf("      matrix:\n        config:");
  if (start === -1) return [];
  const rest = text.slice(start).split("\n").slice(2);
  const out: Array<string> = [];
  for (const line of rest) {
    const match = /^\s{10}- (\S+)$/.exec(line);
    if (match === null) break;
    out.push(match[1]!);
  }
  return out.sort();
};

describe("the CI step that runs the guard sweep", () => {
  it("finds the sweep invocation at all, so the two assertions below are about something", () => {
    // The control. Every other assertion here is over a filtered list, and a filter that matches
    // nothing would make all of them vacuously true — which is the failure mode this whole file
    // is about, so it does not get to happen to this file.
    expect(sweepRunLines(workflowText()).length).toBeGreaterThan(0);
  });

  it("does not pipe the sweep's verdict into another command", () => {
    for (const line of sweepRunLines(workflowText())) {
      // `bash -e` without `pipefail` reports the LAST command's status, so any pipe here replaces
      // the sweep's verdict with the status of whatever follows it.
      expect(line).not.toContain("|");
    }
  });

  it("sweeps every checked-in config, so a new config cannot be added without being swept", () => {
    expect(matrixConfigs(workflowText())).toEqual(checkedInConfigs());
  });
});
