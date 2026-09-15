import * as NodeV8 from "node:v8";

import {
  CommandId,
  EventId,
  MessageId,
  OrchestrationEvent,
  OrchestrationEventType,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { PersistenceDecodeError } from "../Errors.ts";
import { OrchestrationEventStore } from "../Services/OrchestrationEventStore.ts";
import { OrchestrationEventStoreLive } from "./OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
const isPersistenceDecodeError = Schema.is(PersistenceDecodeError);

function messageEvent(threadId: ThreadId, id: string): Omit<OrchestrationEvent, "sequence"> {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    type: "thread.message-sent",
    eventId: EventId.make(id),
    aggregateKind: "thread",
    aggregateId: threadId,
    occurredAt: now,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: {
      threadId,
      messageId: MessageId.make(id),
      role: "assistant",
      text: id,
      turnId: null,
      streaming: false,
      createdAt: now,
      updatedAt: now,
    },
  };
}

function projectCreatedEvent(
  projectId: ProjectId,
  id: string,
): Omit<OrchestrationEvent, "sequence"> {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    type: "project.created",
    eventId: EventId.make(id),
    aggregateKind: "project",
    aggregateId: projectId,
    occurredAt: now,
    commandId: CommandId.make(`cmd-${id}`),
    causationEventId: null,
    correlationId: CommandId.make(`cmd-${id}`),
    metadata: {},
    payload: {
      projectId,
      title: projectId,
      workspaceRoot: `/tmp/${projectId}`,
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  };
}

/**
 * Insert a row the store's own append would refuse to write: a type or an
 * aggregate kind outside this build's unions, or a payload its schema refuses.
 * Returns the sequence the database assigned.
 */
function insertRawEventRow(
  sql: SqlClient.SqlClient,
  row: {
    readonly eventId: string;
    readonly aggregateKind: string;
    readonly aggregateId: string;
    readonly streamVersion: number;
    readonly eventType: string;
    readonly payloadJson: string;
  },
) {
  return sql<{ readonly sequence: number }>`
    INSERT INTO orchestration_events (
      event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
      actor_kind, payload_json, metadata_json
    ) VALUES (
      ${row.eventId}, ${row.aggregateKind}, ${row.aggregateId}, ${row.streamVersion},
      ${row.eventType}, ${"2026-01-01T00:00:00.000Z"}, ${"server"}, ${row.payloadJson}, ${"{}"}
    )
    RETURNING sequence
  `.pipe(Effect.map((rows) => rows[0]!.sequence));
}

const layer = it.layer(
  OrchestrationEventStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("OrchestrationEventStore", (it) => {
  it.effect("stores json columns as strings and replays CLI-origin events", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-01-01T00:00:00.000Z";

      const appended = yield* eventStore.append({
        type: "project.created",
        eventId: EventId.make("evt-store-roundtrip"),
        aggregateKind: "project",
        aggregateId: ProjectId.make("project-roundtrip"),
        occurredAt: now,
        commandId: CommandId.make("cmd-store-roundtrip"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-store-roundtrip"),
        metadata: {
          adapterKey: "codex",
          origin: {
            surface: "cli",
          },
        },
        payload: {
          projectId: ProjectId.make("project-roundtrip"),
          title: "Roundtrip Project",
          workspaceRoot: "/tmp/project-roundtrip",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      const storedRows = yield* sql<{
        readonly payloadJson: string;
        readonly metadataJson: string;
      }>`
        SELECT
          payload_json AS "payloadJson",
          metadata_json AS "metadataJson"
        FROM orchestration_events
        WHERE event_id = ${appended.eventId}
      `;
      assert.equal(storedRows.length, 1);
      assert.equal(typeof storedRows[0]?.payloadJson, "string");
      assert.equal(typeof storedRows[0]?.metadataJson, "string");

      const replayed = yield* Stream.runCollect(eventStore.readFromSequence(0, 10)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      );
      assert.equal(replayed.length, 1);
      assert.equal(replayed[0]?.type, "project.created");
      assert.equal(replayed[0]?.metadata.adapterKey, "codex");
      assert.deepEqual(replayed[0]?.metadata.origin, { surface: "cli" });
    }),
  );

  it.effect("decodes a persisted id through its brand on read", () =>
    Effect.gen(function* () {
      // The boundary every adapter's item-id door rests on: the store decodes
      // persisted events through the brand's decoder, which trims, so a key
      // branded raw (`MessageId.make("assistant: msg_1 ")`) is never the
      // identity the projector sees. A store that stopped decoding on read
      // would make the doors' reason false; this pins the decode boundary, not
      // a visible split.
      const eventStore = yield* OrchestrationEventStore;
      const threadId = ThreadId.make("thread-padded-id");
      const event = messageEvent(threadId, "evt-padded-id");
      yield* eventStore.append({
        ...event,
        payload: { ...event.payload, messageId: MessageId.make("assistant: msg_1 ") },
      });
      // The store is shared across this file's tests: pick the event by id.
      const replayed = yield* Stream.runCollect(eventStore.readFromSequence(0, 100)).pipe(
        Effect.map((chunk) => Array.from(chunk).find((item) => item.eventId === "evt-padded-id")),
      );
      assert.equal(replayed?.type, "thread.message-sent");
      assert.equal(
        replayed?.type === "thread.message-sent" ? replayed.payload.messageId : undefined,
        "assistant: msg_1",
      );
    }),
  );

  it.effect("fails with PersistenceDecodeError when stored json is invalid", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-01-01T00:00:00.000Z";

      const invalidRows = yield* sql<{ readonly sequence: number }>`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES (
          ${EventId.make("evt-store-invalid-json")},
          ${"project"},
          ${ProjectId.make("project-invalid-json")},
          ${0},
          ${"project.created"},
          ${now},
          ${CommandId.make("cmd-store-invalid-json")},
          ${null},
          ${null},
          ${"server"},
          ${"{"},
          ${"{}"}
        )
        RETURNING sequence
      `;

      const replayResult = yield* Effect.result(
        Stream.runCollect(eventStore.readFromSequence(0, 10)),
      );
      assert.equal(replayResult._tag, "Failure");
      if (replayResult._tag === "Failure") {
        assert.ok(isPersistenceDecodeError(replayResult.failure));
        assert.ok(
          replayResult.failure.operation.includes(
            "OrchestrationEventStore.readFromSequence:decodeRows",
          ),
        );
      }
      const scopedResult = yield* eventStore
        .readAggregateRange({
          aggregateKind: "project",
          aggregateId: "project-invalid-json",
          fromSequenceExclusive: 0,
          toSequenceInclusive: invalidRows[0]!.sequence,
        })
        .pipe(Stream.runCollect, Effect.result);
      assert.equal(scopedResult._tag, "Failure");
      if (scopedResult._tag === "Failure") {
        assert.ok(isPersistenceDecodeError(scopedResult.failure));
        assert.ok(
          scopedResult.failure.operation.includes(
            "OrchestrationEventStore.readAggregateRange:decodeRows",
          ),
        );
      }
    }),
  );

  it.effect("reads one aggregate through the captured head across pruned global gaps", () =>
    Effect.gen(function* () {
      const store = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.make("shared-stream-id");
      const first = yield* store.append(messageEvent(threadId, "scoped-first"));
      const pruned = yield* store.append(
        messageEvent(ThreadId.make("pruned-thread"), "pruned-event"),
      );
      const second = yield* store.append(messageEvent(threadId, "scoped-second"));
      // The same stream ID in a different aggregate is not part of this thread.
      // Its invalid JSON must never reach the event decoder.
      yield* sql`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
          actor_kind, payload_json, metadata_json
        ) VALUES (
          'same-id-project', 'project', ${threadId}, 0, 'project.created',
          '2026-01-01T00:00:00.000Z', 'server', '{', '{'
        ), (
          'unrelated-invalid', 'thread', 'unrelated-invalid-thread', 0, 'thread.activity-appended',
          '2026-01-01T00:00:00.000Z', 'server', '{', '{'
        )
      `;
      const last = yield* store.append(messageEvent(threadId, "scoped-last"));
      yield* sql`DELETE FROM orchestration_events WHERE sequence = ${pruned.sequence}`;
      yield* store.append(messageEvent(threadId, "after-captured-head"));

      const events = yield* store
        .readAggregateRange({
          aggregateKind: "thread",
          aggregateId: threadId,
          fromSequenceExclusive: first.sequence,
          toSequenceInclusive: last.sequence,
          limit: 100,
        })
        .pipe(Stream.runCollect);
      assert.deepEqual(
        events.map((event) => event.sequence),
        [second.sequence, last.sequence],
      );
    }),
  );

  it.effect("bounds thread replay metadata and counts UTF-8 bytes without decoding payloads", () =>
    Effect.gen(function* () {
      const store = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly sequence: number }>`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
          actor_kind, payload_json, metadata_json
        ) VALUES
          ('stats-1', 'thread', 'stats-thread', 0, 'thread.message-sent',
            '2026-01-01T00:00:00.000Z', 'provider', '{"output":"😀"}', '{}'),
          ('stats-unrelated', 'thread', 'another-thread', 0, 'thread.created',
            '2026-01-01T00:00:00.000Z', 'provider', printf('%.*c', 10000, 'x'), '{}'),
          ('stats-2', 'thread', 'stats-thread', 1, 'thread.activity-appended',
            '2026-01-01T00:00:00.000Z', 'provider', '{', '{}'),
          ('stats-other-kind', 'project', 'stats-thread', 0, 'project.deleted',
            '2026-01-01T00:00:00.000Z', 'provider', printf('%.*c', 20000, 'x'), '{}'),
          ('stats-3', 'thread', 'stats-thread', 2, 'thread.deleted',
            '2026-01-01T00:00:00.000Z', 'provider', '{"output":"é"}', '{}'),
          ('stats-4', 'thread', 'stats-thread', 3, 'thread.created',
            '2026-01-01T00:00:00.000Z', 'provider', printf('%.*c', 2000, 'x'), '{}')
        RETURNING sequence
      `;
      const range = {
        aggregateKind: "thread" as const,
        aggregateId: "stats-thread",
        fromSequenceExclusive: 0,
        toSequenceInclusive: rows.at(-1)!.sequence,
      };
      assert.deepEqual(yield* store.getAggregateReplayStats({ ...range, maxEvents: 2 }), {
        eventCount: 3,
        payloadBytes: 33,
        hasCreateEvent: false,
      });
      assert.deepEqual(yield* store.getAggregateReplayStats({ ...range, maxEvents: 10 }), {
        eventCount: 4,
        payloadBytes: 2033,
        hasCreateEvent: true,
      });
      assert.deepEqual(
        yield* store.getAggregateReplayStats({
          ...range,
          toSequenceInclusive: rows[2]!.sequence,
          maxEvents: 10,
        }),
        {
          eventCount: 2,
          payloadBytes: 18,
          hasCreateEvent: false,
        },
      );
    }),
  );

  it.effect("keeps later pages below the captured head when new events are appended", () =>
    Effect.gen(function* () {
      const store = yield* OrchestrationEventStore;
      const threadId = ThreadId.make("paged-thread");
      const persisted = yield* Effect.forEach(
        Array.from({ length: 502 }, (_, index) => index),
        (index) => store.append(messageEvent(threadId, `paged-${index}`)),
      );
      const head = persisted.at(-1)!.sequence;
      let appendedDuringReplay = false;
      const replayed = yield* store
        .readAggregateRange({
          aggregateKind: "thread",
          aggregateId: threadId,
          fromSequenceExclusive: 0,
          toSequenceInclusive: head,
          limit: 1_000,
        })
        .pipe(
          Stream.tap(() => {
            if (appendedDuringReplay) return Effect.void;
            appendedDuringReplay = true;
            return store.append(messageEvent(threadId, "appended-during-replay"));
          }),
          Stream.runCollect,
        );
      assert.deepEqual(
        replayed.map((event) => event.sequence),
        persisted.map((event) => event.sequence),
      );
      const limited = store.readFromSequence(persisted[0]!.sequence, 501.9);
      for (let run = 0; run < 2; run++) {
        assert.deepEqual(
          (yield* Stream.runCollect(limited)).map((event) => event.sequence),
          persisted.slice(1).map((event) => event.sequence),
        );
      }
      assert.deepEqual(yield* Stream.runCollect(store.readFromSequence(0, -1)), []);
    }),
  );
});

// Each of these five tests plants rows this build's read must judge: a type or
// an aggregate kind a newer build wrote, and a payload a known type refuses.
// They get a layer each, and read from sequence 0, because the database behind
// a `layer(...)` block is shared by every test in it: a global read in one test
// would count another's appended events, and the refused row would fail the
// skip tests' `readAll`. Reading from 0 is the assertion that the database is
// this test's own.
layer("OrchestrationEventStore unknown event type", (it) => {
  it.effect("skips a row whose type this build does not know and reads the rows after it", () => {
    const messages: string[] = [];
    const annotationsSeen: Array<Record<string, unknown>> = [];
    // Through formatStructured, which is the only logger in this build that
    // hands the annotations to its output. `Logger.Options` carries the message
    // and nothing that was annotated onto the fiber.
    const logger = Logger.map(Logger.formatStructured, (output) => {
      messages.push(String(output.message));
      annotationsSeen.push(output.annotations);
    });

    return Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-01-01T00:00:00.000Z";
      const projectId = ProjectId.make("project-unknown-type");
      const first = yield* eventStore.append(projectCreatedEvent(projectId, "evt-unknown-first"));
      // A newer build wrote this row: a type outside this build's union, with a
      // payload this build cannot decode. The read must skip it and keep going;
      // a read that stops here leaves the server unable to start on this log.
      const unknownSequence = yield* insertRawEventRow(sql, {
        eventId: "evt-unknown-future",
        aggregateKind: "project",
        aggregateId: projectId,
        streamVersion: 1,
        eventType: "project.future-event",
        payloadJson: '{"future":true}',
      });
      const last = yield* eventStore.append(projectCreatedEvent(projectId, "evt-unknown-last"));

      const replayed = yield* Stream.runCollect(eventStore.readFromSequence(0, 10)).pipe(
        Effect.map((chunk) => Array.from(chunk, (event) => event.eventId)),
      );
      assert.deepEqual(replayed, [first.eventId, last.eventId]);

      // A limit that ends a page on the skipped row: a cursor taken from the
      // last decoded event instead of the last row read re-reads the skipped
      // row and stops short of the event after it.
      const pagedPastSkip = yield* Stream.runCollect(eventStore.readFromSequence(0, 2)).pipe(
        Effect.map((chunk) => Array.from(chunk, (event) => event.eventId)),
      );
      assert.deepEqual(pagedPastSkip, [first.eventId, last.eventId]);

      const ranged = yield* eventStore
        .readAggregateRange({
          aggregateKind: "project",
          aggregateId: projectId,
          fromSequenceExclusive: 0,
          toSequenceInclusive: last.sequence,
          limit: 2,
        })
        .pipe(
          Stream.runCollect,
          Effect.map((chunk) => Array.from(chunk, (event) => event.eventId)),
        );
      assert.deepEqual(ranged, [first.eventId, last.eventId]);

      // readAll is the projection bootstrap's reader. It takes no limit, so a
      // reader that decoded each row on its own instead of going through the
      // skip fails the whole replay on this row and the server cannot start.
      const all = yield* Stream.runCollect(eventStore.readAll()).pipe(
        Effect.map((chunk) => Array.from(chunk, (event) => event.eventId)),
      );
      assert.deepEqual(all, [first.eventId, last.eventId]);

      // One warning per skipped row per read: four reads crossed the row. A
      // skip that logs nothing is a silent loss of history.
      const skipped = messages
        .map((message, index) => ({ message, annotations: annotationsSeen[index]! }))
        .filter(({ message }) => message.includes("project.future-event"));
      assert.equal(skipped.length, 4);
      for (const { message, annotations } of skipped) {
        assert.ok(message.includes(String(unknownSequence)));
        // The message is bounded and escaped, so the row a warning names is
        // only recoverable from the annotations. A skip whose warning carries
        // no sequence cannot be turned back into the row that was dropped.
        assert.deepEqual(annotations, {
          sequence: unknownSequence,
          type: "project.future-event",
          aggregateKind: "project",
          aggregateId: projectId,
          occurredAt: now,
        });
      }
    }).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
  });
});

layer("OrchestrationEventStore unknown aggregate kind", (it) => {
  it.effect("skips a row whose aggregate kind this build does not know", () => {
    const messages: string[] = [];
    const logger = Logger.make<unknown, void>(({ message }) => {
      messages.push(String(message));
    });

    return Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-01-01T00:00:00.000Z";
      const projectId = ProjectId.make("project-unknown-kind");
      const first = yield* eventStore.append(
        projectCreatedEvent(projectId, "evt-unknown-kind-first"),
      );
      // 8660c7933c is the input: a new aggregate kind and its event types
      // arrive in one change, so a newer build's row carries both. A read-row
      // schema holding the closed kind union refuses this row before any row
      // is judged, and the whole page fails at decodeRows.
      const unknownSequence = yield* insertRawEventRow(sql, {
        eventId: "evt-unknown-kind",
        aggregateKind: "workspace",
        aggregateId: "workspace-1",
        streamVersion: 0,
        eventType: "workspace.created",
        payloadJson: '{"workspace":true}',
      });
      // An unknown kind carrying a type this build DOES know. The type check
      // alone passes this row to the union decode, which refuses the kind and
      // fails the read the skip exists to keep alive.
      const knownTypeSequence = yield* insertRawEventRow(sql, {
        eventId: "evt-unknown-kind-known-type",
        aggregateKind: "workspace",
        aggregateId: "workspace-1",
        streamVersion: 1,
        eventType: "project.created",
        payloadJson:
          '{"projectId":"workspace-1","title":"Workspace One",' +
          '"workspaceRoot":"/tmp/workspace-1","defaultModelSelection":null,"scripts":[],' +
          `"createdAt":"${now}","updatedAt":"${now}"}`,
      });
      const last = yield* eventStore.append(
        projectCreatedEvent(projectId, "evt-unknown-kind-last"),
      );

      const replayed = yield* Stream.runCollect(eventStore.readFromSequence(0, 10)).pipe(
        Effect.map((chunk) => Array.from(chunk, (event) => event.eventId)),
      );
      assert.deepEqual(replayed, [first.eventId, last.eventId]);

      const ranged = yield* eventStore
        .readAggregateRange({
          aggregateKind: "project",
          aggregateId: projectId,
          fromSequenceExclusive: 0,
          toSequenceInclusive: last.sequence,
          limit: 10,
        })
        .pipe(
          Stream.runCollect,
          Effect.map((chunk) => Array.from(chunk, (event) => event.eventId)),
        );
      assert.deepEqual(ranged, [first.eventId, last.eventId]);

      // One warning per skipped row per read crossing it: the global read
      // crossed both rows, the aggregate read is scoped to "project" and
      // crossed neither. A skip that logs nothing is a silent loss of history.
      const kindWarnings = messages.filter((message) => message.includes("unknown aggregate kind"));
      assert.equal(kindWarnings.length, 2);
      assert.ok(kindWarnings.every((warning) => warning.includes("workspace")));
      assert.ok(kindWarnings.some((warning) => warning.includes(`at sequence ${unknownSequence}`)));
      assert.ok(
        kindWarnings.some((warning) => warning.includes(`at sequence ${knownTypeSequence}`)),
      );
    }).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
  });
});

layer("OrchestrationEventStore skip warning value", (it) => {
  it.effect("bounds and escapes the value a skip warning names", () => {
    const messages: string[] = [];
    const logger = Logger.make<unknown, void>(({ message }) => {
      messages.push(String(message));
    });

    return Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      // Both rows carry a column a newer build wrote. The oversized type is
      // what fills a log line with one row; the type carrying ESC and a
      // newline is what forges log lines around itself.
      const boundedSequence = yield* insertRawEventRow(sql, {
        eventId: "evt-warning-bound",
        aggregateKind: "project",
        aggregateId: "project-warning-value",
        streamVersion: 0,
        eventType: "x".repeat(200_000),
        payloadJson: "{}",
      });
      const escapedSequence = yield* insertRawEventRow(sql, {
        eventId: "evt-warning-escape",
        aggregateKind: "project",
        aggregateId: "project-warning-value",
        streamVersion: 1,
        eventType: "project.\u001b[31mred\nline",
        payloadJson: "{}",
      });

      yield* Stream.runCollect(eventStore.readFromSequence(0, 10));

      const bounded = messages.find((message) =>
        message.includes(`at sequence ${boundedSequence}`),
      );
      assert.ok(bounded !== undefined);
      assert.ok(bounded.includes("xxx"));
      assert.ok(bounded.length < 300);

      const escaped = messages.find((message) =>
        message.includes(`at sequence ${escapedSequence}`),
      );
      assert.ok(escaped !== undefined);
      assert.ok(escaped.includes("project."));
      assert.ok(!escaped.includes("\n"));
      assert.ok(!escaped.includes("\u001b"));
    }).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
  });
});

layer("OrchestrationEventStore page of skipped rows", (it) => {
  it.effect("keeps reading when a whole page decodes to zero events", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project-empty-page");
      const first = yield* eventStore.append(
        projectCreatedEvent(projectId, "evt-empty-page-first"),
      );
      // Two unknown rows wide enough to fill a page on their own. A read that
      // stops when a page yields no events never reaches the known row after
      // them, and the server starts on a log missing everything past here.
      yield* insertRawEventRow(sql, {
        eventId: "evt-empty-page-one",
        aggregateKind: "project",
        aggregateId: projectId,
        streamVersion: 1,
        eventType: "project.future-one",
        payloadJson: '{"future":true}',
      });
      yield* insertRawEventRow(sql, {
        eventId: "evt-empty-page-two",
        aggregateKind: "project",
        aggregateId: projectId,
        streamVersion: 2,
        eventType: "project.future-two",
        payloadJson: '{"future":true}',
      });
      const last = yield* eventStore.append(projectCreatedEvent(projectId, "evt-empty-page-last"));

      const paged = yield* Stream.runCollect(eventStore.readFromSequence(first.sequence, 2)).pipe(
        Effect.map((chunk) => Array.from(chunk, (event) => event.eventId)),
      );
      assert.deepEqual(paged, [last.eventId]);

      const ranged = yield* eventStore
        .readAggregateRange({
          aggregateKind: "project",
          aggregateId: projectId,
          fromSequenceExclusive: first.sequence,
          toSequenceInclusive: last.sequence,
          limit: 2,
        })
        .pipe(
          Stream.runCollect,
          Effect.map((chunk) => Array.from(chunk, (event) => event.eventId)),
        );
      assert.deepEqual(ranged, [last.eventId]);
    }),
  );
});

layer("OrchestrationEventStore refused payload", (it) => {
  it.effect("keeps failing when a known type carries a payload its schema refuses", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      // Valid JSON, known type, wrong shape: corruption or a bug, not a newer
      // build. Reading past it would hide data loss.
      const badPayloadSequence = yield* insertRawEventRow(sql, {
        eventId: "evt-store-bad-payload",
        aggregateKind: "project",
        aggregateId: "project-bad-payload",
        streamVersion: 0,
        eventType: "project.created",
        payloadJson: "{}",
      });

      const replayResult = yield* Effect.result(
        Stream.runCollect(eventStore.readFromSequence(0, 10)),
      );
      assert.equal(replayResult._tag, "Failure");
      if (replayResult._tag === "Failure") {
        assert.ok(isPersistenceDecodeError(replayResult.failure));
        assert.ok(
          replayResult.failure.operation.includes(
            "OrchestrationEventStore.readFromSequence:rowToEvent",
          ),
        );
      }
      const rangedResult = yield* eventStore
        .readAggregateRange({
          aggregateKind: "project",
          aggregateId: "project-bad-payload",
          fromSequenceExclusive: 0,
          toSequenceInclusive: badPayloadSequence,
        })
        .pipe(Stream.runCollect, Effect.result);
      assert.equal(rangedResult._tag, "Failure");
      if (rangedResult._tag === "Failure") {
        assert.ok(isPersistenceDecodeError(rangedResult.failure));
        assert.ok(
          rangedResult.failure.operation.includes(
            "OrchestrationEventStore.readAggregateRange:rowToEvent",
          ),
        );
      }
    }),
  );
});

for (const reader of ["all", "aggregate"] as const) {
  it.effect(`releases consumed pages during ${reader} replay`, () =>
    Effect.gen(function* () {
      const store = yield* OrchestrationEventStore;
      const threadId = ThreadId.make(`retention-${reader}`);
      yield* Effect.forEach(
        Array.from({ length: 1_501 }, (_, index) => index),
        (index) => store.append(messageEvent(threadId, `retention-${reader}-${index}`)),
        { discard: true },
      );
      // oxlint-disable-next-line typescript/no-extraneous-class -- Identifies page markers for V8's heap query.
      class ReplayPage {}
      let count = 0;
      const replay =
        reader === "all"
          ? store.readAll()
          : store.readAggregateRange({
              aggregateKind: "thread",
              aggregateId: threadId,
              fromSequenceExclusive: 0,
              toSequenceInclusive: 1_501,
              limit: 1_501,
            });
      yield* Stream.runForEach(replay, (event) =>
        Effect.sync(() => {
          assert.equal(event.sequence, count + 1);
          if (count % 500 === 0) {
            // Count live page markers after full GC, without timing or heap-size thresholds.
            Object.assign(event, { replayPage: new ReplayPage() });
            assert.isAtMost(NodeV8.queryObjects(ReplayPage, { format: "count" }), 1);
          }
          count++;
        }),
      );
      assert.equal(count, 1_501);
    }).pipe(
      Effect.provide(OrchestrationEventStoreLive.pipe(Layer.provide(SqlitePersistenceMemory))),
    ),
  );
}

it("every event type this build guards on has an event this build can decode", () => {
  // The read admits a row whose type passes Schema.is(OrchestrationEventType)
  // and hands it to the OrchestrationEvent union. The two lists are written by
  // hand in one file, 1300 lines apart, and the skip makes a mismatch quiet in
  // both directions: a literal with no member struct passes the guard and then
  // fails the whole read on the union, which is the failure the skip exists to
  // prevent; a member struct with no literal is skipped on every read forever,
  // logging a warning about an event this build knows perfectly well.
  const guarded = OrchestrationEventType.literals;
  const decodable = OrchestrationEvent.members.map((member) => member.fields.type.literal);
  assert.deepEqual(
    guarded.filter((type) => !decodable.includes(type)),
    [],
    "guarded by OrchestrationEventType with no OrchestrationEvent member: fails the read",
  );
  assert.deepEqual(
    decodable.filter((type) => !guarded.includes(type)),
    [],
    "an OrchestrationEvent member with no OrchestrationEventType literal: skipped on every read",
  );
});
