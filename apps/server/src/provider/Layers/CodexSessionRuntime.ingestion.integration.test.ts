/**
 * The app-server's ids are decoded once at ingestion (`t3_bot-a50`). Before,
 * a `turn/started` whose `turn.id` was "" made `sendTurn` succeed and then
 * nothing: `TurnId.make` threw inside the handler, the throw ended the
 * client's stdin reader and the runtime's notification consumer, no error was
 * logged, and the turn never closed. Driven over the scripted mock peer, the
 * same input must now surface as a provider error naming codex, and every
 * later notification must still arrive.
 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { type ProviderEvent, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { assert, describe } from "vite-plus/test";

import wireFixture from "../testFixtures/codexMultiAgentWire.json" with { type: "json" };
import { makeCodexSessionRuntime } from "./CodexSessionRuntime.ts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

const ROOT = wireFixture.rootThreadId;
const scriptPath = NodePath.join(import.meta.dirname, "../testFixtures/.ingestion-script.json");
const peerPath = NodePath.join(
  import.meta.dirname,
  `../testFixtures/codexCollabMockPeer.${HostProcessPlatform.defaultValue() === "win32" ? "cmd" : "sh"}`,
);

type Script = {
  readonly rootThreadId: string;
  readonly recordRequests: boolean;
  readonly notifications: ReadonlyArray<{ readonly method: string; readonly params: unknown }>;
  readonly holdTurnOpen?: boolean;
  readonly completeTurnOnServerResponse?: boolean;
  readonly serverRequests?: ReadonlyArray<{
    readonly id: number;
    readonly method: string;
    readonly params: unknown;
  }>;
};

const writeScript = (script: Script) =>
  Effect.gen(function* () {
    // @effect-diagnostics-next-line preferSchemaOverJson:off
    NodeFS.writeFileSync(scriptPath, JSON.stringify(script), "utf8");
    NodeFS.rmSync(`${scriptPath}.responses`, { force: true });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        NodeFS.rmSync(scriptPath, { force: true });
        NodeFS.rmSync(`${scriptPath}.responses`, { force: true });
      }),
    );
  });

const summarize = (event: ProviderEvent) => `${event.kind}:${event.method}:${event.turnId ?? "-"}`;

describe("CodexSessionRuntime decodes the app-server's ids at ingestion", () => {
  it.effect("reports an empty turn id as a codex error and keeps delivering", () =>
    Effect.gen(function* () {
      yield* writeScript({
        rootThreadId: ROOT,
        recordRequests: false,
        notifications: [
          {
            method: "turn/started",
            params: { threadId: ROOT, turn: { id: "", status: "inProgress", items: [] } },
          },
          // A valid notification AFTER the refused one: the pump must still be
          // running to deliver it. Without the door, nothing after "" arrives.
          {
            method: "turn/completed",
            params: { threadId: ROOT, turn: { id: "turn-after", status: "completed", items: [] } },
          },
        ],
      });

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-ingestion-empty-turn-id"),
        binaryPath: peerPath,
        cwd: NodeOS.tmpdir(),
        runtimeMode: "full-access",
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
      });
      const collected = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.turnId === "turn-after"),
        Stream.runCollect,
        Effect.forkScoped,
      );
      yield* runtime.start();
      yield* runtime.sendTurn({ input: "an empty turn id follows" });
      const events = Array.from(yield* Fiber.join(collected));

      const refusals = events.filter((event) => event.method === "codex/malformed-id");
      assert.equal(refusals.length, 1, events.map(summarize).join("\n"));
      const refusal = refusals[0]!;
      assert.equal(refusal.kind, "error");
      assert.equal(refusal.provider, "codex");
      assert.include(refusal.message, "codex sent turn/started");
      assert.include(refusal.message, 'turn.id ""');
      // No event was built from the refused id, and the later valid
      // notification arrived — the consumer outlived the bad one.
      assert.isFalse(
        events.some((event) => event.method === "turn/started" && event.turnId === ""),
      );
      assert.equal(events[events.length - 1]?.turnId, "turn-after");

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reports an empty item id on the queue path the same way", () =>
    Effect.gen(function* () {
      // A delta is routed by `readRouteFields`, which `.make`s both the turn id
      // and the item id — the queue consumer's site, not a direct handler's.
      // Same door, same answer.
      yield* writeScript({
        rootThreadId: ROOT,
        recordRequests: false,
        notifications: [
          {
            method: "item/agentMessage/delta",
            params: { threadId: ROOT, turnId: "turn-live", itemId: "", delta: "hello" },
          },
          {
            method: "turn/completed",
            params: { threadId: ROOT, turn: { id: "turn-live", status: "completed", items: [] } },
          },
        ],
      });

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-ingestion-empty-item-id"),
        binaryPath: peerPath,
        cwd: NodeOS.tmpdir(),
        runtimeMode: "full-access",
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
      });
      const collected = yield* runtime.events.pipe(
        Stream.takeUntil(
          (event) => event.method === "turn/completed" && event.turnId === "turn-live",
        ),
        Stream.runCollect,
        Effect.forkScoped,
      );
      yield* runtime.start();
      yield* runtime.sendTurn({ input: "an empty item id follows" });
      const events = Array.from(yield* Fiber.join(collected));

      const refusals = events.filter((event) => event.method === "codex/malformed-id");
      assert.equal(refusals.length, 1, events.map(summarize).join("\n"));
      const refusal = refusals[0]!;
      assert.include(refusal.message, "codex sent item/agentMessage/delta");
      assert.include(refusal.message, 'itemId ""');
      assert.isFalse(events.some((event) => event.method === "item/agentMessage/delta"));
      assert.equal(events[events.length - 1]?.method, "turn/completed");

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "answers a request carrying an empty turn id with a typed error, so the turn closes",
    () =>
      Effect.gen(function* () {
        // A server REQUEST is the other door. Unanswered, the app-server waits
        // for the approval forever and so does the turn; a `.make` throw in the
        // handler left exactly that. The door answers it with invalidParams and
        // reports it, and the peer completes the turn on the response.
        yield* writeScript({
          rootThreadId: ROOT,
          recordRequests: false,
          holdTurnOpen: true,
          completeTurnOnServerResponse: true,
          notifications: [],
          serverRequests: [
            {
              id: 41,
              method: "item/commandExecution/requestApproval",
              params: {
                threadId: ROOT,
                turnId: "",
                itemId: "item-approval",
                command: "rm -rf build",
                cwd: NodeOS.tmpdir(),
                reason: null,
                startedAtMs: 1,
              },
            },
          ],
        });

        const runtime = yield* makeCodexSessionRuntime({
          threadId: ThreadId.make("thread-ingestion-empty-request-turn-id"),
          binaryPath: peerPath,
          cwd: NodeOS.tmpdir(),
          runtimeMode: "auto",
          environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
        });
        const collected = yield* runtime.events.pipe(
          Stream.takeUntil((event) => event.method === "turn/completed"),
          Stream.runCollect,
          Effect.forkScoped,
        );
        yield* runtime.start();
        yield* runtime.sendTurn({ input: "an approval with an empty turn id follows" });
        const events = Array.from(yield* Fiber.join(collected));

        const refusals = events.filter((event) => event.method === "codex/malformed-id");
        assert.equal(refusals.length, 1, events.map(summarize).join("\n"));
        const refusal = refusals[0]!;
        assert.include(refusal.message, "codex sent item/commandExecution/requestApproval");
        assert.include(refusal.message, 'turnId ""');
        // No approval was raised for the operator, and the app-server got an
        // error response (the peer records what it was answered with).
        assert.isFalse(events.some((event) => event.kind === "request"));
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        const recorded = JSON.parse(
          NodeFS.readFileSync(`${scriptPath}.responses`, "utf8").trim().split("\n")[0]!,
        ) as { id: number; result?: unknown; error?: { message?: string } };
        assert.equal(recorded.id, 41);
        assert.isUndefined(recorded.result);
        assert.include(recorded.error?.message ?? "", "an id T3 Code refuses");
        assert.equal(events[events.length - 1]?.method, "turn/completed");

        yield* runtime.close;
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("delivers a thread-scoped hook/started whose turnId is null", () =>
    Effect.gen(function* () {
      // The admit side. `null` is the protocol's spelling of "no turn
      // context" on the hook notifications; a door that reads it as a
      // refused value drops every session-start hook.
      yield* writeScript({
        rootThreadId: ROOT,
        recordRequests: false,
        notifications: [
          {
            method: "hook/started",
            params: {
              threadId: ROOT,
              turnId: null,
              run: {
                id: "hook-run-1",
                displayOrder: 0,
                entries: [],
                eventName: "sessionStart",
                executionMode: "sync",
                handlerType: "command",
                scope: "thread",
                sourcePath: "/tmp/hooks.json",
                startedAt: 1,
                status: "running",
              },
            },
          },
          {
            method: "turn/completed",
            params: { threadId: ROOT, turn: { id: "turn-after", status: "completed", items: [] } },
          },
        ],
      });

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-ingestion-null-hook-turn-id"),
        binaryPath: peerPath,
        cwd: NodeOS.tmpdir(),
        runtimeMode: "full-access",
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
      });
      const collected = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.turnId === "turn-after"),
        Stream.runCollect,
        Effect.forkScoped,
      );
      yield* runtime.start();
      yield* runtime.sendTurn({ input: "a null turn id follows" });
      const events = Array.from(yield* Fiber.join(collected));

      assert.equal(
        events.filter((event) => event.method === "codex/malformed-id").length,
        0,
        events.map(summarize).join("\n"),
      );
      assert.equal(events.filter((event) => event.method === "hook/started").length, 1);

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("raises an elicitation whose turnId is null and answers it with a result", () =>
    Effect.gen(function* () {
      // The request door's admit side. MCP models an elicitation as a
      // standalone request, so its turnId is null outside a turn.
      yield* writeScript({
        rootThreadId: ROOT,
        recordRequests: false,
        holdTurnOpen: true,
        completeTurnOnServerResponse: true,
        notifications: [],
        serverRequests: [
          {
            id: 7101,
            method: "mcpServer/elicitation/request",
            params: {
              mode: "form",
              message: "Allow ChatGPT to use Safari?",
              serverName: "computer-use",
              threadId: ROOT,
              turnId: null,
              _meta: { app_name: "Safari", persist: ["session", "always"] },
              requestedSchema: {
                type: "object",
                properties: { approval: { type: "string", enum: ["once", "session", "always"] } },
                required: ["approval"],
              },
            },
          },
        ],
      });

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-ingestion-null-elicitation-turn-id"),
        binaryPath: peerPath,
        cwd: NodeOS.tmpdir(),
        runtimeMode: "auto",
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
      });
      const collected = yield* runtime.events.pipe(
        Stream.tap((event) =>
          event.kind === "request" && event.requestId !== undefined
            ? runtime.respondToRequest(event.requestId, "accept")
            : Effect.void,
        ),
        Stream.takeUntil((event) => event.method === "turn/completed"),
        Stream.runCollect,
        Effect.forkScoped,
      );
      yield* runtime.start();
      yield* runtime.sendTurn({ input: "an elicitation with a null turn id follows" });
      const events = Array.from(yield* Fiber.join(collected));

      assert.equal(
        events.filter((event) => event.method === "codex/malformed-id").length,
        0,
        events.map(summarize).join("\n"),
      );
      const requests = events.filter((event) => event.kind === "request");
      assert.equal(requests.length, 1);
      assert.equal(requests[0]?.method, "mcpServer/elicitation/request");
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const recorded = JSON.parse(
        NodeFS.readFileSync(`${scriptPath}.responses`, "utf8").trim().split("\n")[0]!,
      ) as { id: number; result?: unknown; error?: unknown };
      assert.equal(recorded.id, 7101);
      assert.isUndefined(recorded.error);
      assert.deepEqual(recorded.result, { action: "accept", content: { approval: "once" } });

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
