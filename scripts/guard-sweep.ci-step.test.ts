/**
 * EIGHT CLAIMS ABOUT THE CI JOB THAT RUNS THE SWEEP AND THE WORKFLOW AROUND IT, all of which
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
 * CLAIM 5 — TWO MERGES DO NOT SHARE A CONCURRENCY GROUP. The group must fall through to
 * `github.sha` on a push; keyed on `github.ref` instead, every merge shares one group. Two merges
 * in a sweep window then meant the second WAITED, and three meant the second's run was cancelled
 * while pending and produced no verdict at all, because `queue` defaults to `single`.
 * `cancel-in-progress` is asserted with it, and what that one does is narrower than it looks: it
 * governs an already-RUNNING run only, never a pending one. Its push arm IS reached — two push
 * runs at one sha share a group, measured, `t3_bot-bfhh` — and false is the value there that
 * never kills a verdict mid-computation. Both are one-token edits to lines nobody re-reads, and
 * reverting either alone breaks the pair, so one test names both.
 *
 * CLAIM 6 — THE TRIGGER LIST IS PINNED, BOTH DIRECTIONS. It is the precondition CLAIM 5 rests on,
 * and it is pinned wider than its own rationale on purpose, so read the failure before deleting it.
 *   WIDER: every push reaches the `github.sha` arm. Adding `tags:` leaves `branches: [main]`
 *   untouched and still reaches it from a ref that is not a branch, so the KEYS of `push:` are
 *   pinned and not only the value of `branches:` — the "admits every other constant" shape.
 *   NARROWER: `on.pull_request` is pinned too, because the damage runs the other way. Narrowing it
 *   to `branches: [main]` drops CI for every PR that does not target main, silently and green.
 *   A guard mutated in one direction only is half a guard.
 *   AND IT REFUSES LEGITIMATE ADDITIONS, which is the trade: `workflow_dispatch:` and
 *   `merge_group:` do not fan out unboundedly, and CLAIM 6 still reds on them. This workflow
 *   declares no `merge_group:` today, so a merge queue runs nothing from it; whoever adds one
 *   edits this claim with it, having read why. The failure message says so rather than reading
 *   as an obstacle.
 *
 * CLAIM 8 — THE SWEEP'S SIX CONFIGS RUN IN PARALLEL. `concurrency:` is not the only way to
 * serialize them: `strategy.max-parallel: 1` does it in one line, from a key no other claim here
 * reads, and restores the cost this file's CLAIM 5 exists to remove. Measured: with that line
 * added, all seven other claims stay green.
 *
 * CLAIM 7 — NO JOB DECLARES ITS OWN `concurrency:`. The workflow-level block above is not the only
 * place this can be undone. Three lines under any job — `concurrency: {group: fork-ci-sweep}` —
 * put every merge's sweep back in one group and restore exactly the serialization CLAIM 5 removes,
 * one level down, where nothing else here is looking. It is not hypothetical in this repo:
 * `pr-vouch.yml` and `thread-transfer-report.yml` both use job-level concurrency today.
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
import * as YAML from "yaml";

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

/**
 * The workflow as a parsed YAML document.
 *
 * The other claims here read text, because their subjects are a step's `run:` string and a matrix
 * list and the text IS what those assert about. The concurrency claims are different: their
 * subjects are VALUES, and a value read from text can be faked by a comment and broken by a
 * reformat. Parsing is the cheaper correctness here, not the heavier one — the hand-rolled scalar
 * reader below cost twenty lines for one value and still left a gap.
 */
const parsedWorkflow = (): Record<string, unknown> =>
  YAML.parse(workflowText()) as Record<string, unknown>;

/** The workflow's `concurrency:` block, parsed. */
const concurrency = (): Record<string, string> => {
  const block = parsedWorkflow()["concurrency"];
  // THE NULL CHECK IS NOT DECORATION. `typeof null === "object"`, so `concurrency:` written
  // with no value under it passes `toBeTypeOf` and the claim below then dies on
  // `TypeError: Cannot read properties of null (reading 'group')` — a crash standing in for a
  // refusal, which is the one failure this repo counts as a defect rather than a red. Measured:
  // an empty `concurrency:` key parses to null and reached that dereference.
  expect(
    block,
    "fork-ci.yml must declare a `concurrency:` block with values under it; it is missing or empty",
  ).toBeTypeOf("object");
  expect(block).not.toBeNull();
  return block as Record<string, string>;
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

describe("the CI job that runs the guard sweep, and the workflow around it", () => {
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

  it("gives each merge its own concurrency group, and pins the cancel guard beside it", () => {
    // READ FROM THE PARSED DOCUMENT, not the file's text, and that is the whole point. A text
    // match is satisfied by a COMMENT quoting the expression — this file is mostly prose, and
    // `# was \`group: ...\` before X` is an ordinary thing to write while changing the line under
    // it, which would leave both mechanisms reverted and this test green. A text match also reds
    // on a reformat that changes nothing, with a message that would be untrue. The parsed value
    // has neither failure: a comment is not a value, and a reformat that preserves the value
    // cannot move it.
    //
    // BOTH VALUES IN ONE TEST because neither is safe alone: the group decides whether two runs
    // meet, and the guard decides what happens to the running one when they do.
    const doc = concurrency();
    expect(doc.group).toBe("fork-ci-${{ github.event.pull_request.number || github.sha }}");
    expect(doc["cancel-in-progress"]).toBe("${{ github.event_name == 'pull_request' }}");
  });

  it("pins both triggers in both directions: nothing new reaches the sha arm, and no PR loses CI", () => {
    // CLAIM 5's precondition. The sha arm of that expression is reached by any push, so widening
    // this trigger turns "main's merges run in parallel" into "every push runs, unbounded and
    // uncancelled", six sweeps at a time. The comment above the group says this; a comment is not
    // a guard.
    //
    // THE KEYS, NOT ONLY THE VALUE. Asserting `branches` alone admits a sibling filter that
    // reaches the same arm from a ref that is not a branch: `tags: ["v*"]` leaves
    // `branches: [main]` exactly as it is, and a tag pushed at a sha already on main lands in
    // that sha's group — the merge run's own group — where the guard is false, so they queue.
    // Pinning `Object.keys(on.push)` is what refuses the sibling.
    const on = parsedWorkflow().on as {
      push?: Record<string, unknown> & { branches?: Array<string> };
      pull_request?: unknown;
    };
    expect(
      Object.keys(on).sort(),
      "fork-ci.yml declares exactly two triggers, and CLAIM 5's group expression is written for " +
        "those two. A new trigger changes which refs reach the `github.sha` arm, so it is a " +
        "decision about the concurrency group and not only about when CI runs. This includes " +
        "`merge_group:`: none is declared today, so a merge queue runs nothing from this " +
        "workflow. Adding a trigger on purpose means editing this claim with it",
    ).toEqual(["pull_request", "push"]);
    expect(
      Object.keys(on.push ?? {}),
      "a sibling filter under `push:` reaches the same `github.sha` arm from a ref that is not a " +
        'branch — `tags: ["v*"]` leaves `branches: [main]` exactly as it is, and a tag pushed ' +
        "at a sha already on main lands in that merge run's own group",
    ).toEqual(["branches"]);
    expect(on.push?.branches).toEqual(["main"]);
    expect(
      on.pull_request,
      "`pull_request:` carries no filters, and pinning that is the other direction of this guard: " +
        "narrowing it — `branches: [main]` — drops CI for every PR that does not target main, " +
        "silently, with every test here still green",
    ).toBeNull();
  });

  it("lets no job declare its own concurrency, which would re-serialize the sweep one level down", () => {
    // CLAIM 5 pins the WORKFLOW-level block, and a job-level block is invisible to it. Three lines
    // under `sweep:` — `concurrency: {group: fork-ci-sweep}` — put every merge's sweep back in one
    // group: the exact defect this file's CLAIM 5 exists to refuse, restored somewhere CLAIM 5 does
    // not look and CLAIM 4's text scan does not name. Measured: with those three lines added, all
    // six other claims stay green.
    //
    // Asserted over EVERY job rather than the sweep job alone, because the sweep is not the only
    // job whose serialization would cost a verdict, and a guard wired at one site tests one site.
    // `pr-vouch.yml:70` and `thread-transfer-report.yml:18` show job-level concurrency is ordinary
    // in this repo, so this is a thing someone will reach for, not a hypothetical.
    const jobs = parsedWorkflow()["jobs"] as Record<string, Record<string, unknown>>;
    expect(Object.keys(jobs).length).toBeGreaterThan(0);
    const declaring = Object.entries(jobs)
      .filter(([, job]) => job !== null && typeof job === "object" && "concurrency" in job)
      .map(([name]) => name);
    expect(declaring).toEqual([]);
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

  it("runs the sweep's configs in parallel, so no strategy key re-serializes them", () => {
    // CLAIM 5 removed the serialization between MERGES. This is the serialization WITHIN one
    // merge, and it is reached by a key nothing else here reads: `strategy.max-parallel`. One
    // line restores the whole cost, with every other claim in this file still green.
    //
    // Not `toBeUndefined()`: raising the cap to the config count is a legitimate edit, and a
    // guard that refuses what it should admit gets deleted by the next person who needs it.
    const jobs = parsedWorkflow()["jobs"] as Record<string, Record<string, unknown>>;
    const strategy = (jobs["sweep"]?.["strategy"] ?? {}) as Record<string, unknown>;
    const configs = matrixConfigs(workflowText());
    expect(configs.length).toBeGreaterThan(0);
    const cap = strategy["max-parallel"];
    expect(
      cap === undefined || (typeof cap === "number" && cap >= configs.length),
      `the sweep's ${configs.length} configs must be free to run at once: max-parallel is ` +
        `${String(cap)}, which serializes them and restores exactly the verdict latency this ` +
        `workflow's concurrency group was changed to remove`,
    ).toBe(true);
  });
});
