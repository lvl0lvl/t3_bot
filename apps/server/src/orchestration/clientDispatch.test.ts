import { HUMAN_OPERATOR_MEMBER_ID, type OrchestrationCommand } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeClientDispatch } from "./clientDispatch.ts";
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
  commandId: "cmd-1",
  projectId: "project-1",
  title: "one",
  workspaceRoot: "/tmp/one",
  createdAt: "2026-01-01T00:00:00.000Z",
} as OrchestrationCommand;

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
      // `toEqual` treats an `origin: undefined` key as equal to no key; the door
      // without an origin must pass NONE, so the key set is asserted by name.
      expect(Object.keys(calls[1]!.options as object)).toEqual(["issuer"]);
    }),
  );
});
