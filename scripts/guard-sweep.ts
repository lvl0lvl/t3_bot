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
 *    that is absent, or that occurs more than once, REFUSES THE WHOLE CONFIG
 *    before the baseline — exit 1, a config failure, because it is knowable
 *    from the config and the tree without running anything. It used to be
 *    `not-run`, found per row four minutes in, after the baseline and every
 *    earlier row had been paid for; twice in one PR the dark row was the one
 *    pinning that PR's own new guard. A four-space anchor was once a substring
 *    of a ten-space line eight lines earlier, so the mutation landed in a
 *    different function, a presence check confirmed
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
  /**
   * WHICH GUARD this row aims at, as a grouping key the report can be held to.
   *
   * The axis label cannot be checked — no schema can tell whether a `find`/
   * `replace` pair makes a guard inert or wider — so the question is what the
   * report is entitled to CLAIM. Without this, the axis notice could only be an
   * existential over the whole sweep: one `wider` row anywhere silenced it for
   * every guard in the file. The checked-in config demonstrated the gap — ten
   * rows over seven guards, three measured on both axes, three `inert` only and
   * one `wider` only, and because three rows were `wider` the report said
   * nothing about the four.
   *
   * It also gives the report a unit a reader recognises. `issuer-required-fails-open`
   * is a mutation id; `requireCommandIssuer` is a guard.
   */
  guard: Schema.String,
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
   * type errors.
   *
   * IGNORED WITH `--in-place`, and that tree is assumed installed. It is not run
   * there because an install writes into the tree the operator is working in, and
   * repointing a link inside a shared `node_modules` is the write that left those
   * 653 tests green. The run says out loud that it skipped it — this field used to
   * read "omit it only with `--in-place`", which told an author omitting was safe
   * there and implied providing it was honoured, and it was discarded in silence.
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

/**
 * Distinct `id`s, because `id` is the report's ONLY row identity.
 *
 * It is the table's second column, the survivor list, the NOT RUN list and every
 * kill heading. Two rows sharing one produce a report whose summary names a row
 * that also appears as a kill, and a reader cannot tell which of the two survived
 * — the summary and the table disagree and both are printed. Nothing checked it:
 * not the schema, which sees two valid strings, and not the runtime, which keyed
 * nothing.
 */
export const duplicateMutationIds = (
  mutations: ReadonlyArray<{ readonly id: string }>,
): ReadonlyArray<string> => {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const mutation of mutations) {
    if (seen.has(mutation.id)) {
      duplicated.add(mutation.id);
    }
    seen.add(mutation.id);
  }
  return [...duplicated].sort();
};

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

/**
 * The rows whose mutation could not be applied AS THE CONFIG IS WRITTEN, decided from the
 * config and the sources alone.
 *
 * PURE, AND IT CALLS `applyMutation` RATHER THAN COUNTING AGAIN. A pre-flight with its own
 * occurrence-counting can drift from the function that applies the mutation — passing a row
 * the real application then fails on, or refusing one that would have applied — and a
 * pre-flight that disagrees with the sweep is a second thing to be wrong. One function, one
 * verdict, and the verdicts are unit-testable without a worktree or a suite.
 *
 * ROWS THE ROW LOOP WOULD REFUSE FOR A REASON OF ITS OWN ARE LEFT ALONE, and the caller has to
 * exclude all of them rather than trusting `read` to do it. `read` returning `undefined` catches
 * ONLY the unreadable; a file outside the swept tree and a gitignored one both read perfectly
 * well, so an earlier version of this comment claimed a protection that covered one of the three
 * reasons it named. The row loop distinguishes untracked from unreadable from
 * outside-the-swept-tree and says which; a refusal here would replace three accurate reasons
 * with one vague one, so `sweep` filters on containment and tracking before it reads.
 *
 * `moved` rows are left alone too. A `setupCommand` that writes a mutation target makes that
 * row unmeasurable, but it is not the config's anchor being wrong, and the per-row NOT RUN
 * says so in the terms the operator can act on.
 */
export const unappliableRows = (input: {
  readonly mutations: ReadonlyArray<Mutation>;
  readonly moved: ReadonlySet<string>;
  readonly read: (file: string) => string | undefined;
}): ReadonlyArray<string> => {
  const out: Array<string> = [];
  for (const mutation of input.mutations) {
    if (input.moved.has(mutation.file)) {
      continue;
    }
    const source = input.read(mutation.file);
    if (source === undefined) {
      continue;
    }
    const outcome = applyMutation(source, mutation);
    if (outcome._tag !== "applied") {
      out.push(`${mutation.id}: ${describeApplyFailure(outcome, mutation.file)}`);
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Reading a run, and deciding what a mutation proved
// ---------------------------------------------------------------------------

/** One suite run, as the set of test names that FAILED. */
export interface RunResult {
  readonly failed: ReadonlySet<string>;
  readonly total: number;
}

export type Verdict =
  /**
   * `confirmed` is whether a SECOND run reproduced these reds.
   *
   * `false` is not a doubt about the kill — it means the confirming run collected
   * fewer tests than the baseline, so it was not evidence either way and the first
   * run's verdict stands unexamined. Without this the two printed identically, so a
   * row whose only red was noise read as a kill whenever the second run happened to
   * under-collect, and the exit code said every mutation was measured (`API-17-15`).
   */
  | { readonly _tag: "killed"; readonly by: ReadonlyArray<string>; readonly confirmed: boolean }
  /**
   * `reds` is present only on a kill DEMOTED because its reds did not reproduce.
   *
   * A plain survivor and a demoted kill are different findings. "Nothing in this suite
   * depends on those lines" is true of the first and false of the second: something
   * depended on them once and did not do it again, which is a flaky test or a flaky
   * kill, and it is the row most needing a human.
   */
  | { readonly _tag: "survived"; readonly reds?: ReadonlyArray<string> }
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
  // `confirmed: false` until `confirm` says otherwise: one run is one run, and the
  // default has to be the weaker claim.
  return newlyFailing.length === 0
    ? { _tag: "survived" }
    : { _tag: "killed", by: newlyFailing, confirmed: false };
};

/**
 * A kill's reds, reduced to the ones a second run reproduced.
 *
 * WHY THIS EXISTS: `server.test.ts` holds order- or timing-dependent tests. An
 * unrelated OTLP-export test reddened in one run of a mutation that touches only the
 * channel-posts HTTP door and stayed green in four re-runs of the same mutation, and a
 * static-filename test did the same thing under a different mutation — two instances in
 * two different tests (`t3_bot-t0v`). Both verdicts were right anyway, because a real
 * kill was present alongside the noise. That is the dangerous shape: nothing in the
 * report distinguished the two reds, so the next row where noise is the ONLY red would
 * read as a kill.
 *
 * ONE RE-RUN, NOT THREE. A test that fails intermittently can pass twice in a row, so
 * this narrows the window rather than closing it; two agreeing runs is the cheapest
 * thing that separates "this mutation broke it" from "this test is unstable", and the
 * cost is one extra suite run per candidate kill.
 *
 * A row whose every red was noise becomes SURVIVED, which is the safe direction: it
 * reports an unpinned guard for someone to look at rather than quietly crediting a
 * mutation with a kill it did not earn.
 */
export const confirm = (
  verdict: Verdict,
  // ONE OBJECT, because the two are both `RunResult` and this is the function whose job
  // is comparing them: `confirm(v, baseline, second)` typechecks and would compare the
  // baseline's failures against themselves, demoting real kills in silence. A named field
  // cannot be transposed (api17).
  runs: { readonly second: RunResult | undefined; readonly baseline: RunResult },
): Verdict => {
  const { second, baseline } = runs;
  if (verdict._tag !== "killed" || second === undefined) {
    return verdict;
  }
  // A confirming run that did not collect says nothing about the reds, so the first
  // run's verdict stands — and says so, because `confirmed: false` is the difference
  // between "these reds reproduced" and "nobody looked".
  if (second.total === 0 || second.total < baseline.total) {
    return { _tag: "killed", by: verdict.by, confirmed: false };
  }
  const again = judge(baseline, second);
  const reproduced =
    again._tag === "killed" ? verdict.by.filter((name) => again.by.includes(name)) : [];
  // DEMOTED, CARRYING WHAT IT LOST. The reds are kept on the survivor so the report can
  // say this row reddened once and not again, rather than filing it with the rows
  // nothing ever depended on.
  return reproduced.length === 0
    ? { _tag: "survived", reds: verdict.by }
    : { _tag: "killed", by: reproduced, confirmed: true };
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
 *
 * IT OPENS WITH PROVENANCE, because the consumer is a merge record read months
 * later and a table with no commit cannot be distinguished from a stale copy of
 * itself. The tool knows the repository, the swept commit and the config path,
 * and used to print none of them: I supplied all three by hand in a PR body and
 * re-transcribed the table three times in one hour as main moved.
 *
 * THE TABLE CARRIES THE VERDICT, NOT THE COUNT, for the same reason. Across
 * those three re-measurements every verdict held and three of ten counts changed
 * twice — so the verdict is the durable claim and the count is working detail.
 * The counts move to the kill list below, which names the tests rather than
 * counting them, and was always the better evidence.
 */
export const formatReport = (
  baseline: RunResult,
  swept: ReadonlyArray<SweptMutation>,
  provenance?: { readonly repo: string; readonly commit: string; readonly config: string },
): string => {
  const lines: Array<string> = [];
  if (provenance !== undefined) {
    lines.push(`Swept ${provenance.repo} at ${provenance.commit} with ${provenance.config}.`);
  }
  lines.push(
    `Baseline: ${baseline.total} tests, ${baseline.failed.size} already failing.`,
    "",
    "| axis | guard | mutation | result |",
    "|---|---|---|---|",
  );
  for (const { mutation, verdict } of swept) {
    const result =
      verdict._tag === "killed"
        ? "killed"
        : verdict._tag === "survived"
          ? "**SURVIVED**"
          : `**NOT RUN** — ${verdict.reason}`;
    lines.push(`| ${mutation.axis} | ${mutation.guard} | ${mutation.id} | ${result} |`);
  }

  const survivors = swept.filter((entry) => entry.verdict._tag === "survived");
  const notRun = swept.filter((entry) => entry.verdict._tag === "not-run");
  // A DEMOTED KILL IS NOT A PLAIN SURVIVOR (`API-17-15`). "Nothing in this suite depends on
  // those lines" is true of one and false of the other: something depended on them once and
  // did not do it again, which is a flaky test or a flaky kill and the row most needing a
  // human. Splitting them is the whole point of keeping `reds` on the verdict.
  const inert = survivors.filter(
    (entry) => entry.verdict._tag === "survived" && entry.verdict.reds === undefined,
  );
  const demoted = survivors.filter(
    (entry) => entry.verdict._tag === "survived" && entry.verdict.reds !== undefined,
  );
  const unconfirmed = swept.filter(
    (entry) => entry.verdict._tag === "killed" && !entry.verdict.confirmed,
  );
  lines.push("");
  if (inert.length > 0) {
    lines.push(
      `${inert.length} survivor${inert.length === 1 ? "" : "s"}: ${inert
        .map((entry) => entry.mutation.id)
        .join(", ")}. Nothing in this suite depends on those lines.`,
    );
  }
  if (demoted.length > 0) {
    lines.push(
      `${demoted.length} NO RED REPRODUCED: ${demoted
        .map((entry) => entry.mutation.id)
        .join(", ")}. Each reddened a test once and not again on a second run with the ` +
        "same mutation applied — a flaky test or a flaky kill, and the rows to look at first.",
    );
  }
  if (unconfirmed.length > 0) {
    lines.push(
      `${unconfirmed.length} KILLED BUT UNCONFIRMED: ${unconfirmed
        .map((entry) => entry.mutation.id)
        .join(", ")}. The confirming run collected fewer tests than the baseline, so ` +
        "whether those reds reproduce is unmeasured; the first run's verdict stands.",
    );
  }
  if (notRun.length > 0) {
    lines.push(
      `${notRun.length} NOT RUN: ${notRun
        .map((entry) => entry.mutation.id)
        .join(", ")}. These are not survivors — no measurement was taken.`,
    );
  }
  // PER GUARD, not per sweep. This used to fire only when NO row anywhere was
  // `wider`, so one `wider` row silenced it for every guard in the file — and
  // the checked-in config did exactly that, reporting nothing about four of its
  // seven guards. The property the header asserts is a property OF A GUARD:
  // making one inert asks what it excludes, and a guard that already excludes
  // too much survives that untouched.
  const axesByGuard = new Map<string, Set<string>>();
  for (const { mutation } of swept) {
    const seen = axesByGuard.get(mutation.guard) ?? new Set<string>();
    seen.add(mutation.axis);
    axesByGuard.set(mutation.guard, seen);
  }
  const oneAxis = (axis: string) =>
    [...axesByGuard.entries()]
      .filter(([, axes]) => axes.size === 1 && axes.has(axis))
      .map(([guard]) => guard)
      .sort();
  const inertOnly = oneAxis("inert");
  const widerOnly = oneAxis("wider");
  if (inertOnly.length > 0) {
    lines.push(
      `Measured on the \`inert\` axis only: ${inertOnly.join(", ")}. Each was asked what it EXCLUDES; a guard that already excludes too much survives that untouched.`,
    );
  }
  if (widerOnly.length > 0) {
    lines.push(
      `Measured on the \`wider\` axis only: ${widerOnly.join(", ")}. Each was asked what it ADMITS; a guard that admits too much survives that untouched.`,
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

/**
 * The config cannot be swept, decided before anything ran.
 *
 * SEPARATE FROM `GuardSweepUnmeasurableError`, whose message is fixed prose asserting
 * "The baseline run produced no measurement" — true where it is used and false at a
 * config check, where no baseline has run, no worktree exists and no suite has been
 * spawned. A tool whose subject is not conflating unmeasured with other states cannot
 * borrow the unmeasured error to say "this config is wrong" (`API-17-16`).
 */
export class GuardSweepConfigError extends Schema.TaggedError<GuardSweepConfigError>()(
  "GuardSweepConfigError",
  { detail: Schema.String },
) {
  override get message() {
    return `This config cannot be swept: ${this.detail}`;
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

/**
 * The tracked paths a `git status --porcelain` line names.
 *
 * Used to refuse a mutation whose target the tree has already moved: the restore is
 * `git checkout -- <file>`, which returns it to HEAD, so a file `setupCommand` wrote into
 * cannot be restored to what the BASELINE was measured on. Nothing else writes to a
 * scratch worktree between its creation and the first row.
 *
 * A rename reads `R  old -> new`, and the new name is the one a mutation could target.
 */
export const statusPaths = (status: string): ReadonlySet<string> => {
  const paths = new Set<string>();
  for (const line of status.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const named = line.slice(3).trim();
    const arrow = named.indexOf(" -> ");
    paths.add(arrow === -1 ? named : named.slice(arrow + 4));
  }
  return paths;
};

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

/**
 * Sweep `root`, which the CALLER has decided is safe to mutate.
 *
 * THE CLEAN-TREE PRECONDITION IS THE CALLER'S, because only the caller knows whose
 * tree this is. Restoration is `git checkout -- <file>`, so uncommitted work in the
 * operator's own tree is work the sweep would discard — and `--in-place` checks for
 * exactly that before it starts. A scratch worktree detached at HEAD has nothing of
 * theirs to lose, and checking it here meant the check ran AFTER `setupCommand` had
 * written to it: an install's own output was reported as the operator's uncommitted
 * work, with "Commit first" said about a temp directory the finalizer then deleted.
 */
export const sweep = Effect.fn("guardSweep.sweep")(function* (
  config: SweepConfig,
  root: string,
  provenance?: { readonly repo: string; readonly commit: string; readonly config: string },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  // READ ONCE, BEFORE THE BASELINE, because after the first restore this answer would
  // be about the sweep's own writes rather than about what it inherited. Empty on
  // `--in-place`, where the handler has already refused a dirty tree; on the worktree
  // path the only writer between `git worktree add` and here is `setupCommand`.
  const moved = statusPaths(yield* mustSucceed(["git", "status", "--porcelain"], root));

  // PRE-FLIGHT, BEFORE THE BASELINE, because an anchor that does not resolve exactly once
  // is a property of the CONFIG and is knowable without running anything. It used to be
  // found per row, four minutes in, after the baseline and every earlier row had been paid
  // for — and NOT RUN says "no measurement was taken" where the truth is "this row cannot
  // be measured as written". Twice in one PR (`t3_bot-2wm`) a refactor moved the line a row
  // anchored on and the dark row was the one pinning that PR's own new guard; both times the
  // author had already pushed.
  //
  // `applyMutation` IS THE CHECK, called rather than reimplemented. A pre-flight that counted
  // occurrences itself could drift from the function that applies the mutation — passing a row
  // the real application then fails on, or refusing one that would have applied — which would
  // make this a second thing to be wrong. One pure function, one verdict.
  //
  // `replace-is-a-no-op` belongs here and is the worse failure of the three: a row whose
  // replacement equals its anchor runs a full suite against unmodified code and reports a
  // SURVIVOR, which reads as a finding rather than as an absence.
  //
  // A row `setupCommand` wrote to is NOT pre-flighted: that is not the config's anchor being
  // wrong, and the per-row NOT RUN below names the cause better than a refusal could.
  const sources = new Map<string, string>();
  for (const mutation of config.mutations) {
    if (sources.has(mutation.file) || moved.has(mutation.file)) {
      continue;
    }
    // CONTAINED FIRST, the same test the row loop applies before it writes. Sharing
    // `applyMutation` is not sharing a computation: the two also have to apply it to the same
    // SOURCE. Without this the pre-flight reads a file outside the swept tree and reaches a
    // different verdict from the row loop for one input class — passing a row on the strength of
    // an outside file that happens to hold the anchor, and paying the baseline the row loop then
    // refuses; or refusing the whole config and blaming the ANCHOR for a row whose defect is
    // that its path leaves the tree. Both measured, and the deciding input was the contents of a
    // file the sweep will never touch. Skipped rather than refused, so the row loop keeps naming
    // the real reason.
    const target = path.join(root, mutation.file);
    const resolved = path.resolve(target);
    const inside = path.resolve(root);
    if (resolved !== inside && !resolved.startsWith(inside + path.sep)) {
      continue;
    }
    // AND TRACKED, the row loop's third gate. A gitignored file inside the tree reads fine and
    // porcelain never mentions it, so without this the pre-flight applies the anchor to a file
    // the sweep cannot restore and, on a stale anchor, blames the ANCHOR for a row whose defect
    // is that git does not track it. Measured: exit 1 naming the anchor where the row loop gives
    // exit 3 naming the tracking. Skipped, not refused — the row loop has the accurate reason.
    const tracked = yield* capture(["git", "ls-files", "--error-unmatch", mutation.file], root);
    if (tracked.exitCode !== 0) {
      continue;
    }
    const read = yield* fs.readFileString(target).pipe(Effect.result);
    if (read._tag === "Success") {
      sources.set(mutation.file, read.success);
    }
  }
  const unmeasurable = unappliableRows({
    mutations: config.mutations,
    moved,
    read: (file) => sources.get(file),
  });
  if (unmeasurable.length > 0) {
    return yield* new GuardSweepConfigError({
      detail:
        `${unmeasurable.length} of ${config.mutations.length} mutations could not be applied, ` +
        `so the sweep would report them as NOT RUN after measuring everything else:\n  ` +
        unmeasurable.join("\n  "),
    });
  }

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

    // CONTAINED, AND RESTORABLE, both checked BEFORE anything is written — because
    // after the write the only copy of the previous contents may be gone.
    //
    // `path.join` does not contain: a `..` in `mutation.file` walks out of the
    // sweep tree, which made refusal 3 ("it mutates only a tree it created") a
    // property of the config's good behaviour rather than of the writes.
    //
    // And `git status --porcelain` says NOTHING about gitignored files, so the
    // dirty-tree refusal cannot see one. Restoration is `git checkout -- <file>`,
    // which needs a tracked path, so an untracked target is overwritten and then
    // unrestorable. Probed: a gitignored file went from IRREPLACEABLE = 1 to = 2
    // permanently, and the run exited 1 telling the operator only that a pathspec
    // did not match.
    const resolved = path.resolve(file);
    const inside = path.resolve(root);
    if (resolved !== inside && !resolved.startsWith(inside + path.sep)) {
      swept.push({
        mutation,
        verdict: { _tag: "not-run", reason: `${mutation.file} resolves outside the swept tree` },
      });
      yield* Console.log(
        `${mutation.id}: NOT RUN — ${mutation.file} resolves outside the swept tree`,
      );
      continue;
    }
    // `API-17-14`. `setupCommand` writing into a mutation target makes that row
    // unmeasurable, and silently so: the baseline ran on HEAD+setup, the restore returns
    // the file to HEAD, and every row after the first is measured on a third thing. A
    // probe watched exactly that — three runs with setup's edit present, the fourth
    // without it, a kill, a survivor, exit 2, and the survivor sentence saying nothing
    // depends on those lines about a row whose tree changed underneath it.
    //
    // Per row, not fatal: the rows setup did not touch are still measurable, and the ones
    // it did say why rather than aborting a sweep that has already been paid for.
    if (moved.has(mutation.file)) {
      const reason =
        `the tree already differs from HEAD at ${mutation.file} (setupCommand writes ` +
        "there), so restoring it would revert that change rather than the mutation";
      swept.push({ mutation, verdict: { _tag: "not-run", reason } });
      yield* Console.log(`${mutation.id}: NOT RUN — ${reason}`);
      continue;
    }
    const tracked = yield* capture(["git", "ls-files", "--error-unmatch", mutation.file], root);
    if (tracked.exitCode !== 0) {
      swept.push({
        mutation,
        verdict: {
          _tag: "not-run",
          reason:
            `git does not track ${mutation.file} — the path may be misspelled, or the ` +
            "file may be gitignored — so it could not be restored",
        },
      });
      yield* Console.log(
        `${mutation.id}: NOT RUN — git does not track ${mutation.file} — the path may be ` +
          "misspelled, or the file may be gitignored — so it could not be restored",
      );
      continue;
    }
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
    // THE WRITE, NARROWED LIKE THE READ. I narrowed the read above and left this
    // one line unnarrowed, so a target that is READABLE but not WRITABLE aborted
    // the whole sweep with `PermissionDenied`, exit 1, no report, and every row
    // already measured discarded. `chmod 444` keeps `git status --porcelain`
    // empty — git tracks only the exec bit — so refusal 4 passes it through, and
    // `.repos/` is read-only vendored code in this repo.
    const written = yield* fs.writeFileString(file, outcome.source).pipe(Effect.result);
    if (written._tag === "Failure") {
      swept.push({
        mutation,
        verdict: { _tag: "not-run", reason: `could not write ${mutation.file}` },
      });
      yield* Console.log(`${mutation.id}: NOT RUN — could not write ${mutation.file}`);
      continue;
    }
    const runs = yield* Effect.gen(function* () {
      const first = yield* runSuite(config, root);
      // A SECOND RUN ONLY WHEN THE FIRST LOOKS LIKE A KILL, and the reds have to
      // appear in both.
      //
      // `server.test.ts` has order- or timing-dependent tests: an unrelated OTLP
      // export test reddened in one run of a mutant that touches only the channel
      // posts HTTP door and stayed green in four re-runs, and a static-filename test
      // did the same under a different mutant (`t3_bot-t0v`, two instances in two
      // different tests). Both verdicts happened to be right because a real kill was
      // present too — the cost is that "killed by 2" with one red being noise makes
      // the NEXT survivor unreadable, and a flaky red can present a survivor as a
      // kill outright.
      //
      // Only on a candidate kill, so the common case pays nothing: a flaky red can
      // turn a survivor into a kill, never a kill into a survivor, so a row that
      // already reads SURVIVED has nothing a second run would change.
      if (first.total === 0 || first.total < baseline.total) {
        return { first, second: undefined };
      }
      const provisional = judge(baseline, first);
      if (provisional._tag !== "killed") {
        return { first, second: undefined };
      }
      yield* Console.log(`${mutation.id}: confirming ${provisional.by.length} red…`);
      return { first, second: yield* runSuite(config, root) };
    }).pipe(
      // THE RESTORE IS NOT BEST-EFFORT. It used to be `Effect.ignore`, which
      // turned a failed `git checkout` into a mutated file left on disk and a
      // report that read as a clean run. `orDie` because there is no recovery:
      // continuing would sweep the next mutation against a still-mutated tree
      // and attribute the result to the wrong line.
      //
      // It wraps BOTH runs, so the confirming run happens while the mutation is
      // still applied — a restore between them would confirm the unmutated tree.
      Effect.ensuring(
        mustSucceed(["git", "checkout", "--", mutation.file], root).pipe(Effect.orDie),
      ),
    );
    const result = runs.first;
    // FEWER TESTS THAN THE BASELINE IS NO MEASUREMENT, and `total === 0` alone was
    // not enough. When a mutation breaks the file it mutates, vitest reports every
    // file that imports it as `status: "failed"` with an EMPTY assertion list —
    // which contributes 0 to both counts. So `total` came back non-zero but
    // smaller, this guard stayed quiet, `judge` found no newly-failing NAME, and
    // the row printed **SURVIVED** under "Nothing in this suite depends on those
    // lines." The tests that would have killed it never ran.
    //
    // That is the tool's central failure mode — an unrun experiment presented as a
    // finding — and one dropped brace in a multi-line `replace` reaches it.
    const verdict =
      result.total === 0
        ? ({
            _tag: "not-run",
            reason: "the mutated suite reported no tests, so it did not run",
          } as const)
        : result.total < baseline.total
          ? ({
              _tag: "not-run",
              reason: `the mutated suite ran ${result.total} tests against the baseline's ${baseline.total}, so something did not collect`,
            } as const)
          : confirm(judge(baseline, result), { second: runs.second, baseline });
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

  return { report: formatReport(baseline, swept, provenance), swept };
});

/**
 * The process's verdict, because a report only a human reads cannot gate.
 *
 *   0  every mutation measured, every one killed
 *   2  at least one SURVIVED, and everything was measured
 *   3  at least one was NOT RUN
 *
 * 3 IS LOUDER THAN 2, and that is the judgement. A survivor is a MEASUREMENT —
 * an unpinned guard, a finding to act on. A NOT RUN is the ABSENCE of one, and an
 * unmeasured sweep must not be able to hide behind one that merely found
 * something.
 *
 * THE STALE ANCHOR THIS RULE WAS ARGUED FROM NO LONGER REACHES IT: an anchor that
 * does not resolve exactly once now refuses the config with exit 1 before the
 * baseline. The rule stands on what is left — a `setupCommand` that wrote a
 * mutation target, a path outside the swept tree, an untracked or unreadable
 * file, a mutant that does not compile, an unconfirmed kill — each of which is a
 * row the run could not measure while measuring others, which is exactly the
 * state that must not hide behind a survivor.
 *
 * 1 is not produced here. It is what the runtime already exits with when the
 * tool or its config failed, which is a third thing again: nothing was measured
 * AND the instrument is broken.
 */
export const exitCodeFor = (swept: ReadonlyArray<SweptMutation>): 0 | 2 | 3 => {
  if (swept.some((entry) => entry.verdict._tag === "not-run")) {
    return 3;
  }
  // AN UNCONFIRMED KILL IS AN ABSENT MEASUREMENT, so it takes the code for one. Without
  // this a row whose only red was noise exits 0 — "every mutation measured, every one
  // killed" — whenever the confirming run happened to under-collect (`API-17-15`).
  if (swept.some((entry) => entry.verdict._tag === "killed" && !entry.verdict.confirmed)) {
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
 *
 * IT WORKS BECAUSE THIS LEAVES THE FIBER SUCCESSFUL, and that is load-bearing.
 * `NodeRuntime`'s only `process.exit` fires from a fiber observer, on completion,
 * and only when the fiber FAILED or a signal arrived. A reviewer read the runtime
 * source to establish that. So if a survivor is ever made to fail the effect —
 * which is a natural-looking refactor, since a survivor is bad news — teardown
 * yields 1, the runtime calls `process.exit(1)`, and both the verdict and the
 * report's flush go with it. A verdict is a RESULT, not a failure.
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
      const duplicated = duplicateMutationIds(parsed.mutations);
      if (duplicated.length > 0) {
        return yield* new GuardSweepConfigError({
          detail:
            `two mutations share an id (${duplicated.join(", ")}), and the report ` +
            "identifies every row by it",
        });
      }
      // RESOLVED ONCE, and `mustSucceed`: a report that quietly names no commit
      // is the stale-table problem this provenance line exists to end, so a repo
      // whose HEAD cannot be read fails loudly instead.
      const commit = (yield* mustSucceed(["git", "rev-parse", "HEAD"], repo)).trim();
      const provenance = { repo, commit, config };

      if (inPlace) {
        // BEFORE ANYTHING ELSE, and on the operator's OWN tree, which is the only
        // path where this check means what its message says: the restore is
        // `git checkout`, so uncommitted work here is work the sweep would discard.
        // It used to live inside `sweep`, where the worktree path reached it after
        // `setupCommand` had written to a freshly detached tree — so an install's own
        // output was reported as the operator's uncommitted work, with "Commit first"
        // said about a temp directory that the finalizer then deleted.
        yield* requireCleanTree(repo);
        yield* Console.log(`sweeping ${repo} IN PLACE — no copy was made`);
        if (parsed.setupCommand !== undefined) {
          // SAID, NOT SILENTLY DROPPED. This path used to return before the setup
          // block, so a configured setup vanished under a flag whose docs implied it
          // was honoured — and the checked-in config's setup is
          // `pnpm install --frozen-lockfile`, whose absence produces the empty-baseline
          // failure that is hardest to read back to a cause.
          //
          // Skipped rather than run: an install writes into the tree the operator is
          // working in, and repointing a link inside a shared `node_modules` is the
          // write that left 653 tests green over 12,246 type errors.
          yield* Console.log(
            `in place: skipping setupCommand (${parsed.setupCommand.join(" ")}) — ` +
              "this tree is assumed installed",
          );
        }
        const outcome = yield* sweep(parsed, repo, provenance);
        yield* Console.log(outcome.report);
        return yield* exitWith(exitCodeFor(outcome.swept));
      }

      // NOT CHECKED FOR CLEANLINESS: the worktree is about to be created detached at
      // HEAD, so nothing of the operator's is in it, and their own tree is not the one
      // being mutated. A dirty `repo` is no obstacle to `git worktree add`.
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
      const outcome = yield* sweep(parsed, tree, provenance);
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
