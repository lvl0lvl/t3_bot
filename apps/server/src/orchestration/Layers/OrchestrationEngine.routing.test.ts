import { OrchestrationCommand, ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";

import { __testing } from "./OrchestrationEngine.ts";

const { commandToAggregateRef } = __testing;

const PROJECT_ID = ProjectId.make("project-under-test");
const THREAD_ID = ThreadId.make("thread-under-test");

/**
 * Where each command's events, command receipt, and `hasEventAfter` scope
 * belong.
 *
 * `command satisfies never` in `commandToAggregateRef` proves only that every
 * command has SOME branch. It cannot prove a command sits in the RIGHT one: a
 * payload carrying both a `projectId` and a `threadId` type-checks in either,
 * so moving `thread.pull-request.sync` into the project group compiles clean
 * and passes the engine suite while silently attaching a thread's events to a
 * project aggregate. This table is the assertion the compiler cannot make.
 */
const EXPECTED_AGGREGATE: Readonly<Record<string, "project" | "thread">> = {
  "project.create": "project",
  "project.meta.update": "project",
  "project.delete": "project",
  "thread.create": "thread",
  "thread.delete": "thread",
  "thread.archive": "thread",
  "thread.unarchive": "thread",
  "thread.settle": "thread",
  "thread.unsettle": "thread",
  "thread.snooze": "thread",
  "thread.unsnooze": "thread",
  "thread.pin": "thread",
  "thread.unpin": "thread",
  "thread.pin.reorder": "thread",
  "thread.active.reorder": "thread",
  "thread.meta.update": "thread",
  "thread.pull-request.link": "thread",
  "thread.pull-request.unlink": "thread",
  "thread.pull-request.sync": "thread",
  "thread.pull-request-link.sync": "thread",
  "thread.runtime-mode.set": "thread",
  "thread.interaction-mode.set": "thread",
  "thread.turn.start": "thread",
  "thread.turn.interrupt": "thread",
  "thread.turn.diff.complete": "thread",
  "thread.approval.respond": "thread",
  "thread.user-input.respond": "thread",
  "thread.user-input.dismiss": "thread",
  "thread.checkpoint.revert": "thread",
  "thread.session.set": "thread",
  "thread.session.stop": "thread",
  "thread.auto-settle": "thread",
  "thread.message.assistant.delta": "thread",
  "thread.message.assistant.complete": "thread",
  "thread.history.import": "thread",
  "thread.proposed-plan.upsert": "thread",
  "thread.activity.append": "thread",
  "thread.revert.complete": "thread",
  "thread.title.regeneration.complete": "thread",
};

/**
 * The command types the contract actually declares, read from the schema rather
 * than hand-listed. Without this the table above rots: a command added to the
 * union would simply never be tested, and the suite would stay green.
 */
const declaredCommandTypes = (): ReadonlyArray<string> => {
  const seen: Array<string> = [];
  const walk = (node: unknown, depth = 0): void => {
    if (!node || typeof node !== "object" || depth > 8) return;
    const record = node as Record<string, unknown>;
    const types = record.types;
    if (Array.isArray(types)) {
      for (const member of types) walk(member, depth + 1);
      return;
    }
    const properties = (record.propertySignatures ?? record.fields ?? record.properties) as unknown;
    const entries: ReadonlyArray<Record<string, unknown>> = Array.isArray(properties)
      ? (properties as Array<Record<string, unknown>>)
      : Object.entries((properties ?? {}) as Record<string, unknown>).map(([name, type]) => ({
          name,
          type,
        }));
    for (const entry of entries) {
      if ((entry.name ?? entry.key) !== "type") continue;
      const valueNode = (entry.type ?? entry.value) as Record<string, unknown> | undefined;
      const literal =
        valueNode?.literal ??
        (valueNode?.ast as Record<string, unknown> | undefined)?.literal ??
        (valueNode?.literals as Array<unknown> | undefined)?.[0];
      if (literal !== undefined) seen.push(String(literal));
    }
    if (record.from) walk(record.from, depth + 1);
    if (record.ast) walk(record.ast, depth + 1);
  };
  walk((OrchestrationCommand as unknown as { readonly ast: unknown }).ast);
  return [...new Set(seen)].sort();
};

/**
 * Both ids on every probe, deliberately. A command carrying only the id its own
 * branch reads would be routed correctly by either branch, so the probe has to
 * make the wrong branch *succeed* at producing the wrong answer.
 */
const probe = (type: string): OrchestrationCommand =>
  ({ type, projectId: PROJECT_ID, threadId: THREAD_ID }) as unknown as OrchestrationCommand;

it("routes every declared command to the aggregate that owns it", () => {
  for (const type of declaredCommandTypes()) {
    const expected = EXPECTED_AGGREGATE[type];
    expect(expected, `${type} is not in the expected-routing table — add it`).toBeDefined();
    const ref = commandToAggregateRef(probe(type));
    expect(ref, `${type} has no branch in commandToAggregateRef`).not.toBeNull();
    expect(ref?.aggregateKind, `${type} routed to the wrong aggregate kind`).toBe(expected);
    // The id matters as much as the kind: a misrouted command stamps a real
    // aggregate, just the wrong one, and that is what corrupts receipt scope.
    expect(ref?.aggregateId, `${type} routed to the wrong aggregate id`).toBe(
      expected === "project" ? PROJECT_ID : THREAD_ID,
    );
  }
});

it("has no table entry for a command the contract no longer declares", () => {
  const declared = new Set(declaredCommandTypes());
  const stale = Object.keys(EXPECTED_AGGREGATE).filter((type) => !declared.has(type));
  expect(stale, "these table entries name commands that no longer exist").toEqual([]);
});

it("reads a non-empty command union, so a broken probe cannot vacuously pass", () => {
  // Without this, a schema-shape change that made the walker return nothing
  // would turn both tests above into no-ops that still report green.
  expect(declaredCommandTypes().length).toBeGreaterThan(30);
});

it("returns null rather than throwing for a command with no branch", () => {
  // The engine runs this on its single command-queue worker fiber: a throw
  // there kills the fiber and hangs every later command on an unsettled
  // Deferred, so an unroutable command must be rejectable, not fatal.
  expect(commandToAggregateRef(probe("thread.does-not-exist"))).toBeNull();
});
