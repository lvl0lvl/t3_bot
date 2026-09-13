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
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as CodexErrors from "effect-codex-app-server/errors";
import { assert, describe } from "vite-plus/test";

import wireFixture from "../testFixtures/codexMultiAgentWire.json" with { type: "json" };
import { makeCodexSessionRuntime } from "./CodexSessionRuntime.ts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

const ROOT = wireFixture.rootThreadId;
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
  readonly turnIds?: ReadonlyArray<string>;
  readonly threadReadTurns?: ReadonlyArray<string>;
  readonly serverRequests?: ReadonlyArray<{
    readonly id: number;
    readonly method: string;
    readonly params: unknown;
  }>;
};

// One script per test: a test that times out tears its script down while
// the next test's peer is still reading it.
const writeScript = (name: string, script: Script) =>
  Effect.gen(function* () {
    const scriptPath = NodePath.join(
      import.meta.dirname,
      `../testFixtures/.ingestion-${name}.json`,
    );
    // @effect-diagnostics-next-line preferSchemaOverJson:off
    NodeFS.writeFileSync(scriptPath, JSON.stringify(script), "utf8");
    NodeFS.rmSync(`${scriptPath}.responses`, { force: true });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        NodeFS.rmSync(scriptPath, { force: true });
        NodeFS.rmSync(`${scriptPath}.responses`, { force: true });
      }),
    );
    return scriptPath;
  });

const summarize = (event: ProviderEvent) => `${event.kind}:${event.method}:${event.turnId ?? "-"}`;

describe("CodexSessionRuntime decodes the app-server's ids at ingestion", () => {
  it("registers every server method through the two doors", () => {
    // The door works by re-pointing every registration. An upstream sync that
    // adds a third `client.handleServer*` line merges clean and lands outside
    // it; this is the only thing that notices.
    const source = NodeFS.readFileSync(
      NodePath.join(import.meta.dirname, "CodexSessionRuntime.ts"),
      "utf8",
    );
    const raw = source.match(/client\.handleServer(?:Notification|Request)\(/g) ?? [];
    assert.deepEqual(raw, ["client.handleServerRequest(", "client.handleServerNotification("]);
  });

  it("brands a turn id from the app-server only behind the doors", () => {
    // Upstream's history restore (fd5553f1a, #11338) adds `readCodexThread`,
    // which pages `thread/turns/list` and builds each turn with
    // `TurnId.make(turn.id)`; the sync conflicts at the `readThread` and
    // `rollbackThread` call sites, ~1400 lines from that `.make`, which
    // merges clean. A resolution that keeps upstream's helper re-admits the
    // input `t3_bot-a50` closed, with nothing that names it. The runtime may
    // brand a turn id only on a value the doors admitted: the route fields
    // read from a notification `refusedIds` passed, and the handlers that run
    // after it. A response's turn id goes through `decodeTurnIdFromResponse`
    // and is never `.make`d. An eleventh `TurnId.make(` is a merge landing
    // outside the doors: route the value through `decodeTurnIdFromResponse`,
    // or add a post-door site to the list below. Only code counts: a comment
    // naming the call is not a brand site. The pin sees the literal
    // `TurnId.make(` only: a cast `as TurnId`, an aliased or destructured
    // `make`, a `.call`/`.apply`/`.bind` on it, or a bracket access stays
    // green (upstream writes none of these today; `vp fmt` normalises the
    // whitespace forms into reach).
    const source = NodeFS.readFileSync(
      NodePath.join(import.meta.dirname, "CodexSessionRuntime.ts"),
      "utf8",
    );
    // A line is a comment only when no code follows its `*/`: `/* note */ const x`
    // and a block closed as ` */ const x` both keep their code, so a call after
    // either still counts. The runtime names `TurnId.make(` in no comment today;
    // the strip's subject is the comment a sync maintainer will write.
    const code = source.replace(/^\s*(?:\/\/|(?!.*\*\/[ \t]*\S)(?:\/\*|\*)).*$/gm, "");
    assert.deepEqual(code.match(/TurnId[?!]?\.make\([^)]*\)/g), [
      // readRouteFields, over a notification refusedIds admitted
      "TurnId.make(notification.params.turn.id)",
      "TurnId.make(notification.params.turnId)",
      "TurnId.make(notification.params.turnId)",
      "TurnId.make(notification.params.turnId)",
      "TurnId.make(notification.params.turnId)",
      // handler bodies that run after refusedIds: turn/started behind
      // handleNotification, then the four guardRequest handlers
      "TurnId.make(payload.turn.id)",
      "TurnId.make(payload.turnId)",
      "TurnId.make(payload.turnId)",
      "TurnId.make(payload.turnId)",
      "TurnId.make(payload.turnId)",
    ]);
  });

  it.effect("reports an empty turn id as a codex error and keeps delivering", () =>
    Effect.gen(function* () {
      const scriptPath = yield* writeScript("empty-turn-id", {
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
      assert.include(refusal.message, "Codex sent turn/started");
      assert.include(refusal.message, 'turn.id ""');
      assert.include(refusal.message, "which is not an id; the message was dropped.");
      // The only turn/started delivered is the peer's own; the refused one
      // produced no event, no handler failure, and the later valid
      // notification arrived — the consumer outlived the bad one.
      assert.equal(events.filter((event) => event.method === "turn/started").length, 1);
      assert.equal(events.filter((event) => event.method === "codex/handler-failed").length, 0);
      assert.equal(events[events.length - 1]?.turnId, "turn-after");

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reports an empty item id on the queue path the same way", () =>
    Effect.gen(function* () {
      // A delta is routed by `readRouteFields`, which `.make`s both the turn id
      // and the item id — the queue consumer's site, not a direct handler's.
      // Same door, same answer.
      const scriptPath = yield* writeScript("empty-item-id", {
        rootThreadId: ROOT,
        recordRequests: false,
        notifications: [
          {
            method: "item/agentMessage/delta",
            params: { threadId: ROOT, turnId: " ", itemId: "", delta: "hello" },
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
      assert.include(refusal.message, "Codex sent item/agentMessage/delta");
      assert.include(
        refusal.message,
        'turnId " ", itemId "", which are not ids; the message was dropped.',
      );
      // The refused delta reached no handler: no handler failure was reported
      // and the peer's own turn/started is the only one delivered.
      assert.equal(events.filter((event) => event.method === "codex/handler-failed").length, 0);
      assert.equal(events.filter((event) => event.method === "turn/started").length, 1);
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
        const scriptPath = yield* writeScript("empty-request-turn-id", {
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
        assert.include(refusal.message, "Codex sent item/commandExecution/requestApproval");
        assert.include(refusal.message, 'turnId ""');
        assert.include(
          refusal.message,
          "which is not an id; the request was answered with an error.",
        );
        // No approval was raised for the operator, and the app-server got an
        // error response (the peer records what it was answered with).
        assert.isFalse(events.some((event) => event.kind === "request"));
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        const recorded = JSON.parse(
          NodeFS.readFileSync(`${scriptPath}.responses`, "utf8").trim().split("\n")[0]!,
        ) as { id: number; result?: unknown; error?: { code?: number; message?: string } };
        assert.equal(recorded.id, 41);
        assert.isUndefined(recorded.result);
        assert.equal(recorded.error?.code, -32602);
        assert.include(recorded.error?.message ?? "", "an id T3 Code refuses");
        assert.equal(events[events.length - 1]?.method, "turn/completed");

        yield* runtime.close;
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("fails sendTurn with a typed error when the turn/start response's id is refused", () =>
    Effect.gen(function* () {
      // A RESPONSE is not a notification and never meets the door. The peer
      // mints the turn id from its script; whitespace is the value `.make`
      // admits and the decoder refuses, so a `.make` here succeeds and hands
      // a garbage id to the session where the decoder fails typed.
      const scriptPath = yield* writeScript("refused-response-turn-id", {
        rootThreadId: ROOT,
        recordRequests: false,
        turnIds: [" "],
        notifications: [],
      });

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-ingestion-refused-response-turn-id"),
        binaryPath: peerPath,
        cwd: NodeOS.tmpdir(),
        runtimeMode: "full-access",
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
      });
      yield* runtime.start();
      const exit = yield* runtime
        .sendTurn({ input: "a whitespace turn id comes back" })
        .pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(exit));
      const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
      assert.instanceOf(failure, CodexErrors.CodexAppServerProtocolParseError);
      assert.equal(failure.method, "turn/start");

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("fails readThread and rollbackThread typed when a snapshot's turn id is refused", () =>
    Effect.gen(function* () {
      // The other response path: a thread snapshot carries every turn's id.
      // Whitespace again, so a `.make` at that site succeeds and the test
      // sees a snapshot instead of the typed failure.
      const scriptPath = yield* writeScript("refused-snapshot-turn-id", {
        rootThreadId: ROOT,
        recordRequests: false,
        threadReadTurns: ["turn-kept", " "],
        notifications: [],
      });

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-ingestion-refused-snapshot-turn-id"),
        binaryPath: peerPath,
        cwd: NodeOS.tmpdir(),
        runtimeMode: "full-access",
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
      });
      yield* runtime.start();
      yield* runtime.sendTurn({ input: "then read the thread back" });

      for (const [method, read] of [
        ["thread/read", runtime.readThread],
        ["thread/rollback", runtime.rollbackThread(1)],
      ] as const) {
        const exit = yield* read.pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit), `${method} succeeded over a refused turn id`);
        const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
        assert.instanceOf(failure, CodexErrors.CodexAppServerProtocolParseError);
        assert.equal(failure.method, method);
      }

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("returns a snapshot whose turn ids all decode", () =>
    Effect.gen(function* () {
      const scriptPath = yield* writeScript("admitted-snapshot-turn-id", {
        rootThreadId: ROOT,
        recordRequests: false,
        threadReadTurns: ["turn-one", "turn-two"],
        notifications: [],
      });

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-ingestion-admitted-snapshot-turn-id"),
        binaryPath: peerPath,
        cwd: NodeOS.tmpdir(),
        runtimeMode: "full-access",
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
      });
      yield* runtime.start();
      yield* runtime.sendTurn({ input: "then read the thread back" });

      const snapshot = yield* runtime.readThread;
      assert.deepEqual(
        snapshot.turns.map((turn) => turn.id),
        ["turn-one", "turn-two"],
      );

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("echoes a refused id as a bounded preview, not at full size", () =>
    Effect.gen(function* () {
      // The refused value goes into the error event, the session's lastError
      // and the response written back over stdin. A 1 MiB id copied into all
      // three at full size is the input this bounds.
      const oversized = " ".repeat(1024 * 1024);
      const scriptPath = yield* writeScript("oversized-turn-id", {
        rootThreadId: ROOT,
        recordRequests: false,
        holdTurnOpen: true,
        completeTurnOnServerResponse: true,
        notifications: [],
        serverRequests: [
          {
            id: 43,
            method: "item/commandExecution/requestApproval",
            params: {
              threadId: ROOT,
              turnId: oversized,
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
        threadId: ThreadId.make("thread-ingestion-oversized-turn-id"),
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
      yield* runtime.sendTurn({ input: "an oversized turn id follows" });
      const events = Array.from(yield* Fiber.join(collected));

      const refusals = events.filter((event) => event.method === "codex/malformed-id");
      assert.equal(refusals.length, 1, events.map(summarize).join("\n"));
      const refusal = refusals[0]!;
      assert.equal(refusal.kind, "error");
      assert.include(refusal.message, `(${oversized.length} chars)`);
      assert.isBelow(refusal.message?.length ?? 0, 512);
      const recorded = NodeFS.readFileSync(`${scriptPath}.responses`, "utf8")
        .trim()
        .split("\n")[0]!;
      assert.include(recorded, '"id":43');
      assert.isBelow(recorded.length, 512);

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("delivers a thread-scoped hook/started whose turnId is null", () =>
    Effect.gen(function* () {
      // The admit side. `null` is the protocol's spelling of "no turn
      // context" on the hook notifications; a door that reads it as a
      // refused value drops every session-start hook.
      const scriptPath = yield* writeScript("null-hook-turn-id", {
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

  it.effect("delivers a padded turn id untrimmed", () =>
    Effect.gen(function* () {
      // The door checks with the brand's decoder, which trims, and the
      // handlers brand the raw wire string, which does not: " turn-pad " is
      // admitted and carried as sent. A door that handed the decoded value
      // to the handlers would deliver "turn-pad" here instead.
      const scriptPath = yield* writeScript("padded-turn-id", {
        rootThreadId: ROOT,
        recordRequests: false,
        notifications: [
          {
            method: "turn/started",
            params: { threadId: ROOT, turn: { id: " turn-pad ", status: "inProgress", items: [] } },
          },
          {
            method: "turn/completed",
            params: { threadId: ROOT, turn: { id: " turn-pad ", status: "completed", items: [] } },
          },
        ],
      });

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-ingestion-padded-turn-id"),
        binaryPath: peerPath,
        cwd: NodeOS.tmpdir(),
        runtimeMode: "full-access",
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
      });
      const collected = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.method === "turn/completed"),
        Stream.runCollect,
        Effect.forkScoped,
      );
      yield* runtime.start();
      yield* runtime.sendTurn({ input: "a padded turn id follows" });
      const events = Array.from(yield* Fiber.join(collected));

      assert.equal(
        events.filter((event) => event.method === "codex/malformed-id").length,
        0,
        events.map(summarize).join("\n"),
      );
      assert.equal(
        events.filter((event) => event.method === "turn/started" && event.turnId === " turn-pad ")
          .length,
        1,
      );

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("raises an elicitation whose turnId is null and answers it with a result", () =>
    Effect.gen(function* () {
      // The request door's admit side. MCP models an elicitation as a
      // standalone request, so its turnId is null outside a turn.
      const scriptPath = yield* writeScript("null-elicitation-turn-id", {
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
