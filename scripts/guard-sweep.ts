#!/usr/bin/env node

/**
 * Mutation sweep: break one guard at a time and ask what notices.
 *
 * Reading finds guards that are wrong. It does not find guards that are INERT —
 * present, plausible, and pinned by nothing — because an inert guard reads
 * exactly like a working one. Every defect this was built from was green under
 * multiple review lanes and died to a two-line mutation.
 *
 * WHAT IT REFUSES TO DO, each because doing it produced a wrong answer that
 * looked like a right one. Numbered rather than counted, because the count
 * said FOUR while the list said five for as long as the fifth existed:
 *
 * 1. It never reports a mutation it could not apply as a survivor. An anchor
 *    that is absent, or that occurs more than once, is `not-run`. A four-space
 *    anchor was once a substring of a ten-space line eight lines earlier, so
 *    the mutation landed in a different function, a presence check confirmed
 *    the mutated text was there, and a load-bearing assertion read as unpinned.
 *    A presence check cannot say WHICH occurrence it found; uniqueness can.
 *
 * 2. It never infers a kill from a failure COUNT. Kills are by test NAME
 *    against the baseline's own failures. A suite with three environment-
 *    dependent failures reports "3 failed" with and without a mutation, so a
 *    mutant that killed nothing is indistinguishable from one that killed
 *    something. A test that was already failing cannot be evidence.
 *
 * 3. It never mutates a tree it did not create. By default it adds its own git
 *    worktree at the repository's HEAD, runs the setup command there, sweeps,
 *    and removes it. A tool that merely ASKS to be pointed at a scratch tree
 *    repeats the accident as a documentation problem: the rule exists because a
 *    review lane restored a live worktree to what it had READ rather than to
 *    what the author had since written, and two correctness fixes vanished.
 *    `--in-place` is the deliberate opt-out, and it still refuses a dirty tree.
 *
 * 4. It never runs in a dirty tree. Mutations are applied to files and undone
 *    from git, so uncommitted work is what gets undone. That has happened.
 *
 * 5. It asks for the AXIS of every mutation and says so in the report. Making a
 *    guard inert asks what it excludes; a guard that already excludes too much
 *    survives that untouched, and only a wider mutation finds it. A sweep with
 *    no `wider` rows has measured one half of the question.
 *
 * ITS EXIT CODE IS A VERDICT: 0 all killed, 2 a survivor, 3 something NOT RUN,
 * 1 the tool or config failed. Every outcome used to be 0 and only a crash was
 * non-zero, which made the code an anti-signal — 0 for the healthy state and 0
 * for the worst one. See `exitCodeFor` for why NOT RUN is louder than a survivor.
 *
 * AND TWO THINGS IT CANNOT DO FOR YOU, both of which report clean.
 *
 * A defence built from two independent parts needs each part mutated
 * SEPARATELY. An escaper that both substitutes control characters and
 * JSON-quotes will survive a test that only asks "is the hostile line still one
 * line", because either part alone satisfies that — and mutating "the escaping"
 * as one unit shows a kill and tells you nothing. Write one mutation per part
 * and pick an input no single part can rescue.
 *
 * A CONSTANT NEEDS ITS DEFINITION MUTATED, not only its call sites. A test that
 * asserts a value by comparing it against the same constant the code spends
 * moves both sides of its comparison together, so it can detect that value's
 * ABSENCE and never its wrongness — while every call-site mutation kills it,
 * because a call site that stops spending the constant does produce a
 * difference. Only mutating the declaration separates the two. I swept two
 * issuer stamps that way, got three kills from three call-site mutants, and
 * reported the test as pinned; a reviewer mutating the constant found the
 * survivor in one edit. If a config's subject is an identity, a flag or a limit
 * that tests import, mutate where it is DECLARED.
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Cause from "effect/Cause";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

// ---------------------------------------------------------------------------
// What a sweep is written as
// ---------------------------------------------------------------------------

/**
 * Which question a mutation asks.
 *
 * `inert` disables a guard: does anything notice it stopped refusing?
 * `wider` makes it refuse more: does anything notice it stopped admitting?
 *
 * They do not overlap, and the second is the one people skip. A guard with no
 * admit-side coverage is a feature that quietly does not work. And code with no
 * guard at all — a lookup that answers "none", a cursor always null — cannot be
 * made inert, so the first axis cannot reach it at all.
 */
export const MutationAxis = Schema.Literals(["inert", "wider"]);

export const Mutation = Schema.Struct({
  /** Short name. It is what the report calls this row. */
  id: Schema.String,
  axis: MutationAxis,
  /** Repo-relative path of the file to mutate. */
  file: Schema.String,
  /** Text to replace. It MUST occur exactly once in the file. */
  find: Schema.String,
  replace: Schema.String,
});
export type Mutation = typeof Mutation.Type;

export const SweepConfig = Schema.Struct({
  /**
   * The suite command, as argv. `--reporter=json` is appended, because results
   * are read by test name rather than by count.
   */
  testCommand: Schema.Array(Schema.String).pipe(Schema.check(Schema.isMinLength(1))),
  mutations: Schema.Array(Mutation).pipe(Schema.check(Schema.isMinLength(1))),
  /**
   * Run once in a freshly created worktree before the baseline, as argv.
   *
   * A new worktree has no `node_modules`, and a sweep MUTATES source, so it
   * cannot borrow another tree's — repointing a link inside a shared
   * `node_modules` is the exact write that left 653 tests green over 12,246
   * type errors. Omit it only with `--in-place`, where the tree is already
   * installed.
   */
  setupCommand: Schema.optional(Schema.Array(Schema.String)),
});
export type SweepConfig = typeof SweepConfig.Type;

/**
 * Decoded straight from the file's text, not via `JSON.parse`.
 *
 * `Schema.fromJsonString` is the repo's rule (`preferSchemaOverJson`) and it is
 * the better shape here anyway: malformed JSON and a well-formed config with a
 * missing field become one typed failure instead of a thrown SyntaxError beside
 * a decode error.
 */
const decodeSweepConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(SweepConfig));

// ---------------------------------------------------------------------------
// Applying one mutation — the part that has been wrong before
// ---------------------------------------------------------------------------

export type ApplyOutcome =
  | { readonly _tag: "applied"; readonly source: string }
  | { readonly _tag: "anchor-absent" }
  | { readonly _tag: "anchor-not-unique"; readonly occurrences: number }
  | { readonly _tag: "replace-is-a-no-op" };

/**
 * Replace the anchor, or say precisely why not.
 *
 * The uniqueness check is the whole point. A non-unique anchor does not fail,
 * it succeeds somewhere unintended — and every downstream signal (the file
 * changed, the text is present, the suite ran) is satisfied by the wrong edit.
 * No later stage can catch it, so it is caught here or not at all.
 *
 * `replace-is-a-no-op` catches the other silent one: a mutation whose
 * replacement equals its anchor runs a full suite to prove unmodified code
 * passes, and reports it as a survivor.
 */
export const applyMutation = (source: string, mutation: Mutation): ApplyOutcome => {
  if (mutation.find === mutation.replace) {
    return { _tag: "replace-is-a-no-op" };
  }
  const occurrences = source.split(mutation.find).length - 1;
  if (occurrences === 0) {
    return { _tag: "anchor-absent" };
  }
  if (occurrences > 1) {
    return { _tag: "anchor-not-unique", occurrences };
  }
  return { _tag: "applied", source: source.replace(mutation.find, mutation.replace) };
};

export const describeApplyFailure = (
  outcome: Exclude<ApplyOutcome, { readonly _tag: "applied" }>,
  file: string,
): string =>
  outcome._tag === "anchor-absent"
    ? `anchor not found in ${file}`
    : outcome._tag === "anchor-not-unique"
      ? `anchor occurs ${outcome.occurrences} times in ${file}; it must occur once, or the mutation lands somewhere you did not choose`
      : "the replacement is identical to the anchor, so this would run the suite against unmodified code";

// ---------------------------------------------------------------------------
// Reading a run, and deciding what a mutation proved
// ---------------------------------------------------------------------------

/** One suite run, as the set of test names that FAILED. */
export interface RunResult {
  readonly failed: ReadonlySet<string>;
  readonly total: number;
}

export type Verdict =
  | { readonly _tag: "killed"; readonly by: ReadonlyArray<string> }
  | { readonly _tag: "survived" }
  | { readonly _tag: "not-run"; readonly reason: string };

/**
 * What a mutant proved, by name.
 *
 * A test already failing at baseline is not evidence: it fails with the
 * mutation and without it, so counting it credits the guard with coverage that
 * does not exist. Only a test that PASSED at baseline and fails now has been
 * shown to depend on the mutated line.
 */
export const judge = (baseline: RunResult, mutant: RunResult): Verdict => {
  const newlyFailing = [...mutant.failed].filter((name) => !baseline.failed.has(name)).sort();
  return newlyFailing.length === 0 ? { _tag: "survived" } : { _tag: "killed", by: newlyFailing };
};

/**
 * Vitest's JSON reporter, reduced to the failing test names.
 *
 * FULL names (`file > describe > test`) rather than titles: two suites
 * routinely share a title, and a bare title lets a kill in one file be credited
 * to a mutation in another.
 *
 * A run that produced no parsable JSON is `total: 0`, which the caller must
 * treat as "no measurement" rather than "nothing failed" — a suite that failed
 * to load has an empty failure set and is not a green run.
 *
 * IT ONLY LOOKS FOR THE REPORTER'S OWN OPENING, `{"numTotalTestSuites"`. It used
 * to fall back to the first `{` anywhere in stdout, which made that promise
 * false: a test that logs a brace put the slice's start inside its own output,
 * `JSON.parse` threw, and the sweep died with an unhandled exception instead of
 * reporting no measurement. The fallback was a guess at robustness and bought
 * the opposite — a crash where the design already had a `not-run` path waiting.
 *
 * The parse is guarded for the same reason and returns the same thing:
 * truncated output is not a green run either.
 */
export const readVitestJson = (stdout: string): RunResult => {
  const from = stdout.indexOf('{"numTotalTestSuites"');
  if (from < 0) {
    return { failed: new Set(), total: 0 };
  }
  type VitestJson = {
    readonly testResults?: ReadonlyArray<{
      readonly name?: string;
      readonly assertionResults?: ReadonlyArray<{
        readonly status?: string;
        readonly fullName?: string;
        readonly title?: string;
      }>;
    }>;
  };
  let parsed: VitestJson;
  try {
    parsed = JSON.parse(stdout.slice(from)) as VitestJson;
  } catch {
    // Truncated or interleaved output. NO MEASUREMENT, which the caller turns
    // into `not-run` — never an empty failure set, which would read as a green
    // run and make every mutation under it "survive".
    return { failed: new Set(), total: 0 };
  }
  const failed = new Set<string>();
  let total = 0;
  for (const file of parsed.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      total += 1;
      if (assertion.status === "failed") {
        failed.add(`${file.name ?? "?"} > ${assertion.fullName ?? assertion.title ?? "?"}`);
      }
    }
  }
  return { failed, total };
};

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export interface SweptMutation {
  readonly mutation: Mutation;
  readonly verdict: Verdict;
}

/**
 * The sweep as the table a PR body wants, plus the sentences a reader would
 * otherwise have to work out.
 *
 * Survivors and not-runs are listed separately and never merged. They look the
 * same in a count and mean opposite things: a survivor is a MEASUREMENT — this
 * guard is pinned by nothing — and a not-run is the ABSENCE of one. Reporting
 * the second as the first is how an unrun experiment becomes a finding.
 */
export const formatReport = (baseline: RunResult, swept: ReadonlyArray<SweptMutation>): string => {
  const lines: Array<string> = [
    `Baseline: ${baseline.total} tests, ${baseline.failed.size} already failing.`,
    "",
    "| axis | mutation | result |",
    "|---|---|---|",
  ];
  for (const { mutation, verdict } of swept) {
    const result =
      verdict._tag === "killed"
        ? `killed by ${verdict.by.length} test${verdict.by.length === 1 ? "" : "s"}`
        : verdict._tag === "survived"
          ? "**SURVIVED**"
          : `**NOT RUN** — ${verdict.reason}`;
    lines.push(`| ${mutation.axis} | ${mutation.id} | ${result} |`);
  }

  const survivors = swept.filter((entry) => entry.verdict._tag === "survived");
  const notRun = swept.filter((entry) => entry.verdict._tag === "not-run");
  lines.push("");
  if (survivors.length > 0) {
    lines.push(
      `${survivors.length} survivor${survivors.length === 1 ? "" : "s"}: ${survivors
        .map((entry) => entry.mutation.id)
        .join(", ")}. Nothing in this suite depends on those lines.`,
    );
  }
  if (notRun.length > 0) {
    lines.push(
      `${notRun.length} NOT RUN: ${notRun
        .map((entry) => entry.mutation.id)
        .join(", ")}. These are not survivors — no measurement was taken.`,
    );
  }
  if (!swept.some((entry) => entry.mutation.axis === "wider")) {
    lines.push(
      "Every mutation here is `inert`, so this sweep asked only what the guards exclude. A guard that already excludes too much survives that axis untouched.",
    );
  }
  if (baseline.failed.size > 0) {
    lines.push(
      `${baseline.failed.size} test${baseline.failed.size === 1 ? " was" : "s were"} already failing and cannot be evidence for any row above.`,
    );
  }
  for (const { mutation, verdict } of swept) {
    if (verdict._tag === "killed") {
      lines.push("", `${mutation.id} — killed by:`, ...verdict.by.map((name) => `  ${name}`));
    }
  }
  return lines.join("\n");
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GuardSweepDirtyTreeError extends Schema.TaggedError<GuardSweepDirtyTreeError>()(
  "GuardSweepDirtyTreeError",
  { status: Schema.String },
) {
  override get message(): string {
    return `A sweep restores files from git, so uncommitted work is what it would discard. Commit first.\n${this.status}`;
  }
}

export class GuardSweepUnmeasurableError extends Schema.TaggedError<GuardSweepUnmeasurableError>()(
  "GuardSweepUnmeasurableError",
  { detail: Schema.String },
) {
  override get message(): string {
    return `The baseline run produced no measurement, so no mutation below it could mean anything: ${this.detail}`;
  }
}

export class GuardSweepProcessError extends Schema.TaggedError<GuardSweepProcessError>()(
  "GuardSweepProcessError",
  { command: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `Guard sweep command '${this.command}' failed: ${this.detail}`;
  }
}

// ---------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------

/**
 * Runs a command and reports EVERYTHING it observed: stdout, stderr, exit code.
 *
 * IT USED TO RETURN STDOUT ALONE, having awaited the exit code and thrown it
 * away, with stderr piped to `"ignore"`. That made two of this tool's five
 * refusals properties of git SUCCEEDING rather than properties of the tool. Point
 * the sweep at a directory that is not a git repository: `git status --porcelain`
 * exits 128, writes its complaint to the discarded stderr, and leaves stdout
 * empty — so the dirty-tree check read `""` as clean, the sweep mutated an
 * uncommitted file, the restore failed silently under `Effect.ignore`, and the
 * run exited 0 reporting a survivor with the content gone. Two review lanes
 * reproduced that independently.
 *
 * It does NOT fail on a non-zero exit, and must not: the test command is
 * expected to exit non-zero, because a killed mutant is a failing suite. The
 * code is returned so each caller can say what it means, and `mustSucceed` is
 * for the four that mean "or there is no measurement".
 */
const capture = Effect.fn("guardSweep.capture")(function* (
  argv: ReadonlyArray<string>,
  cwd: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const [command, ...args] = argv;
  if (command === undefined) {
    return yield* new GuardSweepProcessError({ command: "", detail: "empty command" });
  }
  const fail = (cause: unknown) => new GuardSweepProcessError({ command, detail: String(cause) });
  const handle = yield* spawner
    .spawn(ChildProcess.make(command, args, { cwd, stdin: "ignore", stderr: "pipe" }))
    .pipe(Effect.mapError(fail));
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [
      handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
      handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
      handle.exitCode,
    ],
    { concurrency: "unbounded" },
  ).pipe(Effect.mapError(fail));
  return { command, stdout, stderr, exitCode };
}, Effect.scoped);

/**
 * For a command whose failure means there is no measurement to report.
 *
 * `git status` deciding whether the tree is dirty, `git checkout` putting a
 * mutated file back, `git worktree add` creating the tree that gets mutated, and
 * the config's own setup: if any of these fails, every verdict downstream is
 * about a tree nobody knows the state of. stderr goes into the error, because it
 * is the only thing that says why.
 */
const mustSucceed = Effect.fn("guardSweep.mustSucceed")(function* (
  argv: ReadonlyArray<string>,
  cwd: string,
) {
  const run = yield* capture(argv, cwd);
  if (run.exitCode !== 0) {
    return yield* new GuardSweepProcessError({
      command: run.command,
      detail: `exit ${run.exitCode}: ${run.stderr.trim() || "no stderr"}`,
    });
  }
  return run.stdout;
}, Effect.scoped);

const requireCleanTree = Effect.fn("guardSweep.requireCleanTree")(function* (root: string) {
  const status = yield* mustSucceed(["git", "status", "--porcelain"], root);
  if (status.trim() !== "") {
    return yield* new GuardSweepDirtyTreeError({ status: status.trim() });
  }
});

const runSuite = Effect.fn("guardSweep.runSuite")(function* (config: SweepConfig, root: string) {
  // A NON-ZERO EXIT IS THE NORMAL CASE here and carries no information: a
  // killed mutant is a failing suite. The report is the json on stdout; the code
  // is deliberately not consulted, because the one time it was — inferring a
  // kill from it — a module that failed to LOAD exited non-zero having run
  // nothing and every mutation under it "died".
  const { stdout } = yield* capture([...config.testCommand, "--reporter=json"], root);
  return readVitestJson(stdout);
});

export const sweep = Effect.fn("guardSweep.sweep")(function* (config: SweepConfig, root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  yield* requireCleanTree(root);
  yield* Console.log("baseline…");
  const baseline = yield* runSuite(config, root);
  if (baseline.total === 0) {
    // Not a green run. A suite that failed to load reports no failures, and
    // every mutation under it would then "survive" unanimously.
    return yield* new GuardSweepUnmeasurableError({
      detail: "no tests were reported. Check the test command runs on its own.",
    });
  }

  const swept: Array<SweptMutation> = [];
  for (const mutation of config.mutations) {
    const file = path.join(root, mutation.file);
    // A STALE PATH IS THE SAME CLASS AS A STALE ANCHOR, so it gets the same
    // answer. It used to abort the whole sweep with an untagged PlatformError and
    // discard every measurement already paid for, while a missing anchor degraded
    // to NOT RUN — the header presents NOT RUN as the universal degradation and
    // one half of the same input class did not get it.
    const read = yield* fs.readFileString(file).pipe(Effect.result);
    if (read._tag === "Failure") {
      swept.push({
        mutation,
        verdict: { _tag: "not-run", reason: `could not read ${mutation.file}` },
      });
      yield* Console.log(`${mutation.id}: NOT RUN — could not read ${mutation.file}`);
      continue;
    }
    const source = read.success;
    const outcome = applyMutation(source, mutation);
    if (outcome._tag !== "applied") {
      const reason = describeApplyFailure(outcome, mutation.file);
      swept.push({ mutation, verdict: { _tag: "not-run", reason } });
      yield* Console.log(`${mutation.id}: NOT RUN — ${reason}`);
      continue;
    }
    yield* fs.writeFileString(file, outcome.source);
    const result = yield* runSuite(config, root).pipe(
      // THE RESTORE IS NOT BEST-EFFORT. It used to be `Effect.ignore`, which
      // turned a failed `git checkout` into a mutated file left on disk and a
      // report that read as a clean run. `orDie` because there is no recovery:
      // continuing would sweep the next mutation against a still-mutated tree
      // and attribute the result to the wrong line.
      Effect.ensuring(
        mustSucceed(["git", "checkout", "--", mutation.file], root).pipe(Effect.orDie),
      ),
    );
    const verdict =
      result.total === 0
        ? ({
            _tag: "not-run",
            reason: "the mutated suite reported no tests, so it did not run",
          } as const)
        : judge(baseline, result);
    swept.push({ mutation, verdict });
    yield* Console.log(
      `${mutation.id}: ${
        verdict._tag === "killed"
          ? `killed by ${verdict.by.length}`
          : verdict._tag === "survived"
            ? "SURVIVED"
            : `NOT RUN — ${verdict.reason}`
      }`,
    );
  }

  return { report: formatReport(baseline, swept), swept };
});

/**
 * The process's verdict, because a report only a human reads cannot gate.
 *
 *   0  every mutation measured, every one killed
 *   2  at least one SURVIVED, and everything was measured
 *   3  at least one was NOT RUN
 *
 * 3 IS LOUDER THAN 2, and that is the judgement. A survivor is a MEASUREMENT —
 * an unpinned guard, a finding to act on. A NOT RUN is the ABSENCE of one, and it
 * undermines the rest of the run: every `find` is a quotation of a file the
 * config does not own, so if one anchor went stale the others are quoting the
 * same moving target and the survivor list can no longer be read as complete. An
 * unmeasured sweep must not be able to hide behind one that merely found
 * something.
 *
 * 1 is not produced here. It is what the runtime already exits with when the
 * tool or its config failed, which is a third thing again: nothing was measured
 * AND the instrument is broken.
 */
export const exitCodeFor = (swept: ReadonlyArray<SweptMutation>): 0 | 2 | 3 => {
  if (swept.some((entry) => entry.verdict._tag === "not-run")) {
    return 3;
  }
  return swept.some((entry) => entry.verdict._tag === "survived") ? 2 : 0;
};

/**
 * Records `code` as the process's eventual exit status. Does NOT terminate.
 *
 * `process.exitCode = n` rather than `process.exit(n)`, and the difference is a
 * leaked git worktree every time. I first wrote this as `process.exit` with a
 * comment claiming the scope's finalizers ran before it "because it is the
 * command's return value rather than a call inside it". That was false.
 * `process.exit` terminates immediately and synchronously, so the scope never
 * closes and `git worktree remove` never runs. Measured: five sweeps, and the
 * four that exited non-zero each left a worktree behind in `$TMPDIR` and
 * registered in the swept repo. The one that exited 0 cleaned up, because 0 goes
 * through `Effect.void` and lets the runtime finish normally.
 *
 * Setting `exitCode` lets the runtime drain: the scope closes, the finalizer
 * removes the tree, and the process then exits with this status. A tool whose
 * whole subject is destructive side effects does not get to leak a worktree on
 * the paths that matter — which are exactly the non-zero ones.
 */
const exitWith = (code: 0 | 2 | 3) =>
  Effect.sync(() => {
    process.exitCode = code;
  });

/**
 * A worktree of `repo` at its current HEAD, removed when the scope closes.
 *
 * `--detach` so the sweep never occupies a branch the author might want to check
 * out, and `--force` on removal because a sweep that failed mid-mutation leaves
 * a modified file — the tree is disposable and refusing to remove it would
 * leave litter that looks like work in progress.
 */
const scratchWorktree = (repo: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const parent = yield* fs.makeTempDirectoryScoped({ prefix: "guard-sweep-" });
    const tree = path.join(parent, "tree");
    yield* mustSucceed(["git", "worktree", "add", "--detach", tree, "HEAD"], repo);
    yield* Effect.addFinalizer(() =>
      // Tolerated, unlike the others: the sweep is finished and this tree is
      // disposable. Said out loud anyway, because what is left behind is a git
      // worktree the operator now has to remove by hand.
      mustSucceed(["git", "worktree", "remove", "--force", tree], repo).pipe(
        Effect.catchCause((cause) =>
          Console.error(`could not remove the sweep worktree at ${tree}: ${Cause.pretty(cause)}`),
        ),
      ),
    );
    return tree;
  });

const configFlag = Flag.file("config").pipe(
  Flag.withDescription("Sweep configuration: the test command, the mutations, and the setup."),
);

const repoFlag = Flag.directory("repo").pipe(
  Flag.withDescription("Repository to sweep. Its HEAD is what gets mutated, in a copy."),
  Flag.withDefault(process.cwd()),
);

const inPlaceFlag = Flag.boolean("in-place").pipe(
  Flag.withDescription(
    "Mutate --repo directly instead of a scratch worktree. Only when the tree is yours, committed, and nobody else is reading it.",
  ),
  Flag.withDefault(false),
);

export const guardSweepCommand = Command.make(
  "guard-sweep",
  { config: configFlag, repo: repoFlag, inPlace: inPlaceFlag },
  ({ config, repo, inPlace }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const parsed = yield* decodeSweepConfig(yield* fs.readFileString(config));

      if (inPlace) {
        yield* Console.log(`sweeping ${repo} IN PLACE — no copy was made`);
        const outcome = yield* sweep(parsed, repo);
        yield* Console.log(outcome.report);
        return yield* exitWith(exitCodeFor(outcome.swept));
      }

      const tree = yield* scratchWorktree(repo);
      yield* Console.log(`sweeping a worktree of ${repo} at ${tree}`);
      if (parsed.setupCommand !== undefined) {
        yield* Console.log(`setup: ${parsed.setupCommand.join(" ")}`);
        yield* mustSucceed(parsed.setupCommand, tree);
      } else {
        // Said rather than discovered from a wall of module-resolution errors.
        yield* Console.log(
          "no setupCommand: a fresh worktree has no node_modules, so the suite will probably fail to load",
        );
      }
      const outcome = yield* sweep(parsed, tree);
      yield* Console.log(outcome.report);
      return yield* exitWith(exitCodeFor(outcome.swept));
    }),
).pipe(Command.withDescription("Break one guard at a time and report which ones nothing notices."));

if (import.meta.main) {
  Command.run(guardSweepCommand, { version: "0.0.0" }).pipe(
    Effect.scoped,
    Effect.provide([Logger.layer([Logger.consolePretty()]), NodeServices.layer]),
    NodeRuntime.runMain,
  );
}
