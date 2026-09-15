/**
 * FIVE CLAIMS ABOUT THE CI JOB THAT RUNS THE SWEEP AND THE WORKFLOW AROUND IT, all of which
 * fail SILENTLY when broken.
 *
 * The bead (`t3_bot-2ij`, opened 2026-09-12 from qa29's F7 on PR #29) is about the sweep not
 * being in CI at all. #68, two days later, is the instance that showed what that costs and is why
 * it went P2: the tool
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
 * CLAIM 3 — THE INVOCATION USES THE MATRIX VALUE. Hardcode one config in the `run:` line and
 * every other assertion here stays green while six CI jobs sweep the same config under six names
 * taken from the matrix — 80 of 98 rows unswept, reported as six green rows. Nothing machine-reads
 * those names; `main` carries no required status checks, so a human reading them is the gate.
 *
 * CLAIM 4 — THE STEP AND ITS MATRIX ARE NOT DISARMED. Every edit that stops this job gating lives
 * outside the `run:` line: `continue-on-error: true` (sweep exits 2, step failed, JOB GREEN),
 * `if: false`, and `strategy.matrix.exclude:` (the list still names all six, fewer jobs expand).
 *
 * CLAIM 5 — MAIN'S RUNS NEITHER CANCEL NOR QUEUE BEHIND EACH OTHER. `cancel-in-progress` must
 * stay guarded by the event name, or a merge kills the previous merge's sweep outright; and the
 * group must fall through to `github.sha` on a push, or every merge shares one group and the
 * second waits out the first (measured at ~25 minutes for the slowest config). Both are one-token
 * edits to a line nobody re-reads, and neither reddens anything else in this repo.
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

/**
 * The `sweep:` job's text alone, from its key to the next top-level job key.
 *
 * Everything below reads THIS, not the whole file. Unbound, `indexOf` finds the first match in
 * the file: a job defined above `sweep:` carrying its own `matrix:`/`config:` pair becomes what
 * the matrix assertion compares, and two configs can silently stop being swept while the test
 * stays green. The `-1` guard is not decoration — `slice(-1)` returns the last character of the
 * file, and every assertion over it would go quietly vacuous.
 */
const sweepJob = (text: string): string => {
  const start = text.indexOf("\n  sweep:\n");
  expect(start).toBeGreaterThan(-1);
  // The NEXT top-level job key, whichever it is — not `test_server:` by name. Naming it meant any
  // job legally inserted between the two was swallowed into this slice, and an ordinary job-level
  // `if:` on that neighbour reddened the sweep's own assertions. A red that says "the sweep is
  // disarmed" when it is not teaches the next author to weaken the assertion.
  const next = /\n {2}[A-Za-z_][A-Za-z0-9_-]*:\n/g;
  next.lastIndex = start + 1;
  const match = next.exec(text);
  return text.slice(start, match === null ? undefined : match.index);
};

/**
 * The job's lines with YAML comments removed — whole-line AND trailing.
 *
 * Trailing comments are the reason this exists. `fork-ci.yml`'s sweep job is mostly prose, and a
 * comment is a natural thing to add to the `run:` line; a `|` inside one would fail the no-pipe
 * assertion below with a message saying the verdict is piped, which would be untrue. The next
 * author's cheapest way to green is then to weaken that assertion, and the guard is gone.
 */
const commandLines = (jobText: string): ReadonlyArray<string> =>
  jobText
    .split("\n")
    .map((line) => line.replace(/\s#.*$/, "").trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

/**
 * The Sweep step's `run:` value, including any block-scalar or continuation lines.
 *
 * Everything the step actually executes, as one string. Read this rather than filtering lines:
 * a line filter only sees lines it recognises, and every defeat found for the old one lived on a
 * line the filter skipped.
 */
const sweepRunValue = (text: string): string => {
  const job = sweepJob(text);
  const at = job.indexOf("      - name: Sweep\n");
  expect(at).toBeGreaterThan(-1);
  const lines = job.slice(at).split("\n");
  const runAt = lines.findIndex((line) => line.startsWith("        run:"));
  expect(runAt).toBeGreaterThan(-1);
  const head = lines[runAt]!.replace(/^\s*run:\s*/, "");
  const body: Array<string> = [];
  for (const line of lines.slice(runAt + 1)) {
    if (line.trim() === "" || line.startsWith("          ")) body.push(line.trim());
    else break;
  }
  // YAML's own rule, mirrored: in a BLOCK scalar (`|`, `>`) a `#` is literal command text; in a
  // PLAIN scalar a whitespace-preceded `#` starts a comment and everything after it is dropped
  // before the shell ever sees it. Getting this backwards in either direction is a live defect —
  // strip inside a block and a real `| tee` disappears; do not strip on a plain line and an
  // ordinary trailing comment reds the test with a message that is untrue.
  if (head.startsWith("|") || head.startsWith(">")) {
    return body.join(" ").replace(/\s+/g, " ").trim();
  }
  return [head, ...body]
    .join(" ")
    .replace(/\s+#.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
};

/** The sweep job's command lines that invoke the sweep. */
const sweepRunLines = (text: string): ReadonlyArray<string> =>
  commandLines(sweepJob(text)).filter((line) => line.includes("guard-sweep.ts"));

const checkedInConfigs = (): ReadonlyArray<string> =>
  NodeFS.readdirSync(NodePath.join(REPO, "scripts"))
    .filter((name) => /^guard-sweep\..+\.json$/.test(name))
    .map((name) => name.replace(/^guard-sweep\./, "").replace(/\.json$/, ""))
    .sort();

const matrixConfigs = (text: string): ReadonlyArray<string> => {
  const job = sweepJob(text);
  const start = job.indexOf("      matrix:\n        config:");
  if (start === -1) return [];
  const rest = job.slice(start).split("\n").slice(2);
  const out: Array<string> = [];
  for (const line of rest) {
    const match = /^\s{10}- (\S+)$/.exec(line);
    if (match === null) break;
    out.push(match[1]!);
  }
  return out.sort();
};

describe("the CI step that runs the guard sweep", () => {
  it("finds the sweep invocation at all, so the assertions over it are about something", () => {
    // The control for `sweepRunLines` ONLY. It does not cover the config assertion below, which
    // never calls `sweepRunLines` — that test's own two filters are guarded inside it. Saying
    // "this protects everything below" would be the same shape of false claim this file exists
    // to catch: an assertion that is green because nothing reached it.
    expect(sweepRunLines(workflowText()).length).toBeGreaterThan(0);
  });

  it("runs exactly the sweep command, with nothing wrapped around it", () => {
    // ASSERTED POSITIVELY, and that is the point. Checking for an ABSENT `|` was defeated three
    // ways, each of them a reformat a reviewer would wave through: a pipe on a backslash
    // continuation line (the filter only reads lines naming the tool); `if ! sweep; then …; fi`
    // (no pipe at all, exit code swallowed by the `if`); and a quoted `#` in an argument, which
    // the comment stripper truncated along with everything after it — including a real pipe.
    // An equality over the whole `run:` value has no such gaps: any wrapper, redirection,
    // continuation or added argument changes the string and reds this line.
    expect(sweepRunValue(workflowText())).toBe(
      "node scripts/guard-sweep.ts --config scripts/guard-sweep.${{ matrix.config }}.json",
    );
  });

  it("does not disarm the sweep step or shrink its matrix", () => {
    // Every edit that silently stops this job gating lives OUTSIDE the run line, so no assertion
    // over that line can see it. `continue-on-error: true` is the one to fear: the sweep exits 2,
    // the step is recorded failed, and the JOB GOES GREEN — one line, reads as defensive, and is
    // what gets added when a config looks flaky. `if: false` skips the step; `exclude:` drops
    // configs while the list above still names all six.
    const job = commandLines(sweepJob(workflowText())).join("\n");
    expect(job).not.toContain("continue-on-error");
    expect(job).not.toContain("if:");
    expect(job).not.toContain("exclude:");
  });

  it("keeps main's runs from cancelling or queueing behind each other", () => {
    // Two mechanisms, two failure modes, both silent. Reverting `cancel-in-progress` to a bare
    // `true` lets a merge cancel the previous merge's sweep — the verdict never arrives. Reverting
    // the group to `github.ref` puts every merge in one group, so nothing is cancelled and the
    // second merge simply waits: main's verdict arrives, up to a sweep-length late. Neither edit
    // reddens anything else, which is why they are asserted here.
    const text = workflowText();
    expect(text).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    expect(text).toContain("group: fork-ci-${{ github.event.pull_request.number || github.sha }}");
  });

  it("sweeps every checked-in config, so a new config cannot be added without being swept", () => {
    // Both filters must be non-empty before the comparison means anything: `matrixConfigs`
    // returns [] when its anchor misses, `checkedInConfigs` returns [] when nothing matches the
    // glob, and `[]` equals `[]`. Move the configs to a subdirectory and express the matrix in
    // `include:` form — both legal, CI keeps working — and without this line the guard is dead
    // permanently, green, with no diff to show it.
    const checked = checkedInConfigs();
    expect(checked.length).toBeGreaterThan(0);
    expect(matrixConfigs(workflowText())).toEqual(checked);
  });
});
