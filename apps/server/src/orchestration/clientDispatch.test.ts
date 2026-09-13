import {
  CommandId,
  HUMAN_OPERATOR_MEMBER_ID,
  type OrchestrationCommand,
  ProjectId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";

import { makeClientDispatch, withClientDispatch } from "./clientDispatch.ts";
import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine.ts";

/**
 * The stamp itself, tested off the engine: the door tests in `server.test.ts`
 * ("issues every websocket command as the human operator", "issues an
 * HTTP-dispatched command as the human operator too") prove each DOOR still
 * stamps; this proves the one place they stamp FROM, on inputs a door cannot
 * vary — a command with no issuer invariant, and an origin that is absent
 * rather than empty.
 */
const recording = () => {
  const calls: Array<{ readonly command: OrchestrationCommand; readonly options: unknown }> = [];
  const engine: Pick<OrchestrationEngineShape, "dispatch"> = {
    dispatch: (command, options) =>
      Effect.sync(() => {
        calls.push({ command, options });
        return { sequence: calls.length };
      }),
  };
  return { calls, engine };
};

// A command with NO issuer invariant: the stamp must be unconditional, not
// keyed on the command being a channel one — the mutant that stamps only
// `channel.*` commands leaves this bare.
const command: OrchestrationCommand = {
  type: "project.create",
  commandId: CommandId.make("cmd-1"),
  projectId: ProjectId.make("project-1"),
  title: "one",
  workspaceRoot: "/tmp/one",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("makeClientDispatch", () => {
  it.effect("issues every command as the human operator, spelled out", () =>
    Effect.gen(function* () {
      const { calls, engine } = recording();
      const result = yield* makeClientDispatch(engine)(command);
      expect(result).toEqual({ sequence: 1 });
      // The literal, not `operatorCommandIssuer()`: comparing against the
      // constructor moves both sides together and cannot catch a wrong issuer.
      expect(calls).toEqual([
        {
          command,
          options: { issuer: { memberKind: "human", memberId: HUMAN_OPERATOR_MEMBER_ID } },
        },
      ]);
    }),
  );

  it.effect("carries the door's origin when it has one, and no key when it has none", () =>
    Effect.gen(function* () {
      const { calls, engine } = recording();
      const origin = { surface: "web" as const, appVersion: "1.2.3" };
      yield* makeClientDispatch(engine, origin)(command);
      yield* makeClientDispatch(engine)(command);
      expect(calls.map((call) => call.options)).toEqual([
        { origin, issuer: { memberKind: "human", memberId: HUMAN_OPERATOR_MEMBER_ID } },
        { issuer: { memberKind: "human", memberId: HUMAN_OPERATOR_MEMBER_ID } },
      ]);
      // `toEqual` treats an `origin: undefined` key as equal to no key. The
      // compiler refuses `origin: undefined` under `exactOptionalPropertyTypes`
      // (TS2379 on `{ origin, issuer }`), so the key set asserted by name is
      // the runtime pin of the same shape.
      expect(Object.keys(calls[1]!.options as object)).toEqual(["issuer"]);
    }),
  );

  it.effect("hands a helper the same engine, dispatching as the door", () =>
    Effect.gen(function* () {
      // THE INPUT THAT BREAKS A SPREAD: `streamDomainEvents` is a getter that
      // opens a fresh subscription per access. Counted here; `{ ...engine }`
      // reads it once at the hand-off and the count stays at 1.
      let streamReads = 0;
      const { calls, engine: recorder } = recording();
      const engine: OrchestrationEngineShape = {
        ...recorder,
        readEvents: () => Stream.empty,
        readThreadEvents: () => Stream.empty,
        getThreadReplayStats: () => Effect.die("unused"),
        subscribeDomainEvents: Effect.succeed(Stream.empty),
        get streamDomainEvents() {
          streamReads += 1;
          return Stream.empty;
        },
        latestSequence: Effect.succeed(0),
      };
      const handed = withClientDispatch(engine, makeClientDispatch(engine));
      yield* handed.dispatch(command);
      expect(calls.map((call) => call.options)).toEqual([
        { issuer: { memberKind: "human", memberId: HUMAN_OPERATOR_MEMBER_ID } },
      ]);
      void handed.streamDomainEvents;
      void handed.streamDomainEvents;
      expect(streamReads).toBe(2);
      expect(yield* handed.latestSequence).toBe(0);
    }),
  );
});

describe("withClientDispatch", () => {
  it.effect("refuses a helper's own options rather than rewriting them", () =>
    Effect.gen(function* () {
      // THE INPUT THAT BREAKS A PASS-THROUGH: a helper handing `{ issuer }` of
      // its own. The shape's `dispatch(command, options?)` accepts it at `tsc`;
      // a hand-off that forwards to the bound dispatch regardless reaches the
      // recorder as the door's operator, with nothing saying the helper's
      // issuer was dropped.
      const { calls, engine: recorder } = recording();
      const engine: OrchestrationEngineShape = {
        ...recorder,
        readEvents: () => Stream.empty,
        readThreadEvents: () => Stream.empty,
        getThreadReplayStats: () => Effect.die("unused"),
        subscribeDomainEvents: Effect.succeed(Stream.empty),
        get streamDomainEvents() {
          return Stream.empty;
        },
        latestSequence: Effect.succeed(0),
      };
      const handed = withClientDispatch(engine, makeClientDispatch(engine));
      const exit = yield* Effect.exit(
        handed.dispatch(command, { issuer: { memberKind: "system", memberId: "seeder" } }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(true);
        expect(String(Cause.squash(exit.cause))).toContain("refused, not merged");
      }
      expect(calls).toEqual([]);
      // The same command without options is the door's stamp, as before.
      yield* handed.dispatch(command);
      expect(calls.map((call) => call.options)).toEqual([
        { issuer: { memberKind: "human", memberId: HUMAN_OPERATOR_MEMBER_ID } },
      ]);
    }),
  );
});
