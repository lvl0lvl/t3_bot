/**
 * The app-server's ids are decoded once at ingestion (`t3_bot-a50`). Before,
 * a `turn/started` whose `turn.id` was "" made `sendTurn` succeed and then
 * nothing: `TurnId.make` threw inside the handler, the throw ended the
 * client's stdin reader and the runtime's notification consumer, no error was
 * logged, and the turn never closed. Driven over the scripted mock peer, the
 * same input must now surface as a provider error naming codex, and every
 * later notification must still arrive.
 */
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
};

const writeScript = (script: Script) =>
  Effect.gen(function* () {
    // @effect-diagnostics-next-line preferSchemaOverJson:off
    NodeFS.writeFileSync(scriptPath, JSON.stringify(script), "utf8");
    yield* Effect.addFinalizer(() => Effect.sync(() => NodeFS.rmSync(scriptPath, { force: true })));
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

      const refusal = events.find((event) => event.method === "codex/malformed-id");
      assert.isDefined(refusal, summarize(events[events.length - 1]!));
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

      const refusal = events.find((event) => event.method === "codex/malformed-id");
      assert.isDefined(refusal);
      assert.include(refusal.message, "codex sent item/agentMessage/delta");
      assert.include(refusal.message, 'itemId ""');
      assert.isFalse(events.some((event) => event.method === "item/agentMessage/delta"));
      assert.equal(events[events.length - 1]?.method, "turn/completed");

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
