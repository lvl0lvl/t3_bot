#!/usr/bin/env node

/**
 * Mutation sweep: break one guard at a time and ask what notices.
 *
 * Reading finds guards that are wrong. It does not find guards that are INERT —
 * present, plausible, and pinned by nothing — because an inert guard reads
 * exactly like a working one. Every defect this was built from was green under
 * multiple review lanes and died to a two-line mutation.
 *
 * FOUR THINGS IT REFUSES TO DO, each because doing them produced a wrong answer
 * that looked like a right one:
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
 * 3. It never runs in a dirty tree. Mutations are applied to files and undone
 *    from git, so uncommitted work is what gets undone. That has happened, and
 *    it silently reverted two correctness fixes.
 *
 * 4. It asks for the AXIS of every mutation and says so in the report. Making a
 *    guard inert asks what it excludes; a guard that already excludes too much
 *    survives that untouched, and only a wider mutation finds it. A sweep with
 *    no `wider` rows has measured one half of the question.
 *
 * AND ONE THING IT CANNOT DO FOR YOU. A defence built from two independent
 * parts needs each part mutated SEPARATELY. An escaper that both substitutes
 * control characters and JSON-quotes will survive a test that only asks "is the
 * hostile line still one line", because either part alone satisfies that — and
 * mutating "the escaping" as one unit shows a kill and tells you nothing. Write
 * one mutation per part and pick an input no single part can rescue.
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
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
});
export type SweepConfig = typeof SweepConfig.Type;

const decodeSweepConfig = Schema.decodeUnknownEffect(SweepConfig);

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
 */
export const readVitestJson = (stdout: string): RunResult => {
  const start = stdout.indexOf('{"numTotalTestSuites"');
  const fallback = stdout.indexOf("{");
  const from = start >= 0 ? start : fallback;
  if (from < 0) {
    return { failed: new Set(), total: 0 };
  }
  const parsed = JSON.parse(stdout.slice(from)) as {
    readonly testResults?: ReadonlyArray<{
      readonly name?: string;
      readonly assertionResults?: ReadonlyArray<{
        readonly status?: string;
        readonly fullName?: string;
        readonly title?: string;
      }>;
    }>;
  };
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
    .spawn(ChildProcess.make(command, args, { cwd, stdin: "ignore", stderr: "ignore" }))
    .pipe(Effect.mapError(fail));
  const [stdout] = yield* Effect.all(
    [handle.stdout.pipe(Stream.decodeText(), Stream.mkString), handle.exitCode],
    { concurrency: "unbounded" },
  ).pipe(Effect.mapError(fail));
  return stdout;
}, Effect.scoped);

const requireCleanTree = Effect.fn("guardSweep.requireCleanTree")(function* (root: string) {
  const status = yield* capture(["git", "status", "--porcelain"], root);
  if (status.trim() !== "") {
    return yield* new GuardSweepDirtyTreeError({ status: status.trim() });
  }
});

const runSuite = Effect.fn("guardSweep.runSuite")(function* (config: SweepConfig, root: string) {
  const stdout = yield* capture([...config.testCommand, "--reporter=json"], root);
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
    const source = yield* fs.readFileString(file);
    const outcome = applyMutation(source, mutation);
    if (outcome._tag !== "applied") {
      const reason = describeApplyFailure(outcome, mutation.file);
      swept.push({ mutation, verdict: { _tag: "not-run", reason } });
      yield* Console.log(`${mutation.id}: NOT RUN — ${reason}`);
      continue;
    }
    yield* fs.writeFileString(file, outcome.source);
    const result = yield* runSuite(config, root).pipe(
      Effect.ensuring(capture(["git", "checkout", "--", mutation.file], root).pipe(Effect.ignore)),
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

  return formatReport(baseline, swept);
});

const configFlag = Flag.file("config").pipe(
  Flag.withDescription("Sweep configuration: the test command and the mutations to apply."),
);

const rootFlag = Flag.directory("root").pipe(
  Flag.withDescription(
    "Tree to mutate. Use a scratch worktree whenever anyone else is reading yours.",
  ),
  Flag.withDefault(process.cwd()),
);

export const guardSweepCommand = Command.make(
  "guard-sweep",
  { config: configFlag, root: rootFlag },
  ({ config, root }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const raw = yield* fs.readFileString(config);
      const parsed = yield* decodeSweepConfig(JSON.parse(raw));
      yield* Console.log(yield* sweep(parsed, root));
    }),
).pipe(Command.withDescription("Break one guard at a time and report which ones nothing notices."));

if (import.meta.main) {
  Command.run(guardSweepCommand, { version: "0.0.0" }).pipe(
    Effect.scoped,
    Effect.provide([Logger.layer([Logger.consolePretty()]), NodeServices.layer]),
    NodeRuntime.runMain,
  );
}
