import {
  CommandId,
  EventId,
  IsoDateTime,
  NonNegativeInt,
  OrchestrationActorKind,
  OrchestrationAggregateId,
  OrchestrationAggregateKind,
  OrchestrationEvent,
  OrchestrationEventMetadata,
  OrchestrationEventType,
} from "@t3tools/contracts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type OrchestrationEventStoreError,
} from "../Errors.ts";
import {
  OrchestrationEventStore,
  type OrchestrationEventStoreShape,
} from "../Services/OrchestrationEventStore.ts";

const decodeEvent = Schema.decodeUnknownEffect(OrchestrationEvent);
const UnknownFromJsonString = Schema.fromJsonString(Schema.Unknown);
const EventMetadataFromJsonString = Schema.fromJsonString(OrchestrationEventMetadata);

const AppendEventRequestSchema = Schema.Struct({
  eventId: EventId,
  aggregateKind: OrchestrationAggregateKind,
  streamId: OrchestrationAggregateId,
  type: OrchestrationEventType,
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  actorKind: OrchestrationActorKind,
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  payloadJson: UnknownFromJsonString,
  metadataJson: EventMetadataFromJsonString,
});

const OrchestrationEventPersistedRowSchema = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: EventId,
  type: OrchestrationEventType,
  aggregateKind: OrchestrationAggregateKind,
  aggregateId: OrchestrationAggregateId,
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  payload: UnknownFromJsonString,
  metadata: EventMetadataFromJsonString,
});

// The persisted row's columns, with three widened. A new column added to the
// row above reaches the read without a second edit here.
const OrchestrationEventReadRowSchema = Schema.Struct({
  ...OrchestrationEventPersistedRowSchema.fields,
  // Plain strings, not the closed unions: a row written by a newer build
  // carries a type, an aggregate kind and an id shape this build does not
  // know, and the read decides per row whether to skip it (unknown type or
  // kind) or fail (known type and kind, refused payload). 8660c7933c is the
  // input: a new aggregate kind and its event types arrive in one change, so a
  // closed kind union here refuses the whole page before any row is judged.
  type: Schema.String,
  aggregateKind: Schema.String,
  aggregateId: Schema.String,
});

const isKnownEventType = Schema.is(OrchestrationEventType);
const isKnownAggregateKind = Schema.is(OrchestrationAggregateKind);

// A row whose type or aggregate kind is outside this build's unions was
// written by a newer build. The read skips it and logs one warning per row per
// read, and keeps failing on a KNOWN kind and type whose payload its schema
// refuses: that is corruption, and reading past it would hide data loss.
// ProviderSessionRuntimeRepository.list (31ca9e5531, upstream #3951) skips any
// row that fails to decode; this reader narrows that on purpose: an unknown
// type or kind skips, a refused payload of a known type still fails.
// A skipped row is crossed by the projector watermark permanently on this
// build; upgrading to the build that knows the type does NOT replay it from
// the watermark. The projection pipeline's bootstrap repairs that: it keeps a
// decoder ledger per build and rebuilds every projection from 0 when a row of
// a type or kind it newly decodes sits inside an older build's applied range
// (ProjectionPipeline.ts, findProjectionHole). The input: a newer build's
// event at sequence N skipped here, then any known event at N+1 applied.
// DISCLOSED: the warning is per row per READER, and uncapped. Each projector's
// bootstrap, the cleanup scan and the mention-wake catch-up each read the log
// at start, and trailing unknown rows re-warn on every start until a known
// event lands beyond them.
const decodeRowsSkippingUnknownTypes = (
  rows: ReadonlyArray<typeof OrchestrationEventReadRowSchema.Type>,
  operation: string,
) =>
  Effect.forEach(rows, (row) => {
    const unknown = !isKnownAggregateKind(row.aggregateKind)
      ? { what: "aggregate kind", value: row.aggregateKind }
      : !isKnownEventType(row.type)
        ? { what: "type", value: row.type }
        : undefined;
    if (unknown !== undefined) {
      // The value is a column a newer build wrote, so the warning bounds and
      // escapes it: a 200,000-character event type fills the log line, and a
      // type carrying ESC or a newline forges log lines around it. The
      // annotation keeps the raw value for whoever reads the structured log.
      return Effect.logWarning(
        `orchestration event skipped: unknown ${unknown.what} ${JSON.stringify(unknown.value.slice(0, 120))} at sequence ${row.sequence}`,
      ).pipe(
        Effect.annotateLogs({
          sequence: row.sequence,
          type: row.type,
          aggregateKind: row.aggregateKind,
          aggregateId: row.aggregateId,
          occurredAt: row.occurredAt,
        }),
        Effect.as(Option.none<OrchestrationEvent>()),
      );
    }
    // The guarded row goes to the union decode whole. decodeEvent takes
    // unknown, and the union brands the kind and the id itself.
    return decodeEvent(row).pipe(
      Effect.mapError(toPersistenceDecodeError(operation)),
      Effect.map(Option.some),
    );
  }).pipe(
    Effect.map((decoded) =>
      decoded.flatMap((event) => (Option.isSome(event) ? [event.value] : [])),
    ),
  );

const HasEventAfterRequestSchema = Schema.Struct({
  aggregateKind: Schema.String,
  aggregateId: Schema.String,
  type: Schema.optional(Schema.String),
  sequenceExclusive: NonNegativeInt,
});

const ReadFromSequenceRequestSchema = Schema.Struct({
  sequenceExclusive: NonNegativeInt,
  limit: Schema.Number,
});
const AggregateReplayRequestSchema = Schema.Struct({
  aggregateKind: OrchestrationAggregateKind,
  aggregateId: Schema.String,
  fromSequenceExclusive: NonNegativeInt,
  toSequenceInclusive: NonNegativeInt,
  limit: Schema.Number,
});
const AggregateReplayStatsRowSchema = Schema.Struct({
  eventCount: Schema.Number,
  payloadBytes: Schema.Number,
  hasCreateEvent: Schema.Number,
});
const DEFAULT_READ_FROM_SEQUENCE_LIMIT = 1_000;
const READ_PAGE_SIZE = 500;

function inferActorKind(
  event: Omit<OrchestrationEvent, "sequence">,
): Schema.Schema.Type<typeof OrchestrationActorKind> {
  if (event.commandId !== null && event.commandId.startsWith("provider:")) {
    return "provider";
  }
  if (event.commandId !== null && event.commandId.startsWith("server:")) {
    return "server";
  }
  if (
    event.metadata.providerTurnId !== undefined ||
    event.metadata.providerItemId !== undefined ||
    event.metadata.adapterKey !== undefined
  ) {
    return "provider";
  }
  if (event.commandId === null) {
    return "server";
  }
  return "client";
}

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): OrchestrationEventStoreError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeEventStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const appendEventRow = SqlSchema.findOne({
    Request: AppendEventRequestSchema,
    Result: OrchestrationEventPersistedRowSchema,
    execute: (request) =>
      sql`
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
          ${request.eventId},
          ${request.aggregateKind},
          ${request.streamId},
          COALESCE(
            (
              SELECT stream_version + 1
              FROM orchestration_events
              WHERE aggregate_kind = ${request.aggregateKind}
                AND stream_id = ${request.streamId}
              ORDER BY stream_version DESC
              LIMIT 1
            ),
            0
          ),
          ${request.type},
          ${request.occurredAt},
          ${request.commandId},
          ${request.causationEventId},
          ${request.correlationId},
          ${request.actorKind},
          ${request.payloadJson},
          ${request.metadataJson}
        )
        RETURNING
          sequence,
          event_id AS "eventId",
          event_type AS "type",
          aggregate_kind AS "aggregateKind",
          stream_id AS "aggregateId",
          occurred_at AS "occurredAt",
          command_id AS "commandId",
          causation_event_id AS "causationEventId",
          correlation_id AS "correlationId",
          payload_json AS "payload",
          metadata_json AS "metadata"
      `,
  });

  const readEventRowsFromSequence = SqlSchema.findAll({
    Request: ReadFromSequenceRequestSchema,
    Result: OrchestrationEventReadRowSchema,
    execute: (request) =>
      sql`
        SELECT
          sequence,
          event_id AS "eventId",
          event_type AS "type",
          aggregate_kind AS "aggregateKind",
          stream_id AS "aggregateId",
          occurred_at AS "occurredAt",
          command_id AS "commandId",
          causation_event_id AS "causationEventId",
          correlation_id AS "correlationId",
          payload_json AS "payload",
          metadata_json AS "metadata"
        FROM orchestration_events
        WHERE sequence > ${request.sequenceExclusive}
        ORDER BY sequence ASC
        LIMIT ${request.limit}
      `,
  });

  const readAggregateEventRows = SqlSchema.findAll({
    Request: AggregateReplayRequestSchema,
    Result: OrchestrationEventReadRowSchema,
    execute: (request) =>
      sql`
        SELECT
          sequence,
          event_id AS "eventId",
          event_type AS "type",
          aggregate_kind AS "aggregateKind",
          stream_id AS "aggregateId",
          occurred_at AS "occurredAt",
          command_id AS "commandId",
          causation_event_id AS "causationEventId",
          correlation_id AS "correlationId",
          payload_json AS "payload",
          metadata_json AS "metadata"
        FROM orchestration_events
        WHERE aggregate_kind = ${request.aggregateKind}
          AND stream_id = ${request.aggregateId}
          AND sequence > ${request.fromSequenceExclusive}
          AND sequence <= ${request.toSequenceInclusive}
        ORDER BY sequence ASC
        LIMIT ${request.limit}
      `,
  });

  const readAggregateReplayStats = SqlSchema.findOne({
    Request: AggregateReplayRequestSchema,
    Result: AggregateReplayStatsRowSchema,
    execute: (request) =>
      sql`
        SELECT
          COUNT(*) AS "eventCount",
          COALESCE(SUM(octet_length(payload_json)), 0) AS "payloadBytes",
          COALESCE(MAX(event_type IN (
            'thread.created', 'project.created'
          )), 0) AS "hasCreateEvent"
        FROM (
          SELECT payload_json, event_type
          FROM orchestration_events
          WHERE aggregate_kind = ${request.aggregateKind}
            AND stream_id = ${request.aggregateId}
            AND sequence > ${request.fromSequenceExclusive}
            AND sequence <= ${request.toSequenceInclusive}
          ORDER BY sequence ASC
          LIMIT ${request.limit}
        )
      `,
  });

  const append: OrchestrationEventStoreShape["append"] = (event) =>
    appendEventRow({
      eventId: event.eventId,
      aggregateKind: event.aggregateKind,
      streamId: event.aggregateId,
      type: event.type,
      causationEventId: event.causationEventId,
      correlationId: event.correlationId,
      actorKind: inferActorKind(event),
      occurredAt: event.occurredAt,
      commandId: event.commandId,
      payloadJson: event.payload,
      metadataJson: event.metadata,
    }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "OrchestrationEventStore.append:insert",
          "OrchestrationEventStore.append:decodeRow",
        ),
      ),
      Effect.flatMap((row) =>
        decodeEvent(row).pipe(
          Effect.mapError(toPersistenceDecodeError("OrchestrationEventStore.append:rowToEvent")),
        ),
      ),
    );

  const readFromSequence: OrchestrationEventStoreShape["readFromSequence"] = (
    sequenceExclusive,
    limit = DEFAULT_READ_FROM_SEQUENCE_LIMIT,
  ) => {
    const normalizedLimit = Math.max(0, Math.floor(limit));
    if (normalizedLimit === 0) {
      return Stream.empty;
    }
    return Stream.paginate(
      { cursor: sequenceExclusive, remaining: normalizedLimit },
      ({ cursor, remaining }) =>
        readEventRowsFromSequence({
          sequenceExclusive: cursor,
          limit: Math.min(remaining, READ_PAGE_SIZE),
        }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              "OrchestrationEventStore.readFromSequence:query",
              "OrchestrationEventStore.readFromSequence:decodeRows",
            ),
          ),
          Effect.flatMap((rows) =>
            decodeRowsSkippingUnknownTypes(
              rows,
              "OrchestrationEventStore.readFromSequence:rowToEvent",
            ).pipe(
              Effect.map((events) => {
                // The cursor comes from the last row read, not the last event
                // decoded: a skipped row at the end of a page would otherwise
                // be re-read forever or end the read short.
                const lastRow = rows.at(-1);
                const nextRemaining = remaining - events.length;
                return [
                  events,
                  lastRow === undefined || nextRemaining <= 0
                    ? Option.none()
                    : Option.some({ cursor: lastRow.sequence, remaining: nextRemaining }),
                ] as const;
              }),
            ),
          ),
        ),
    );
  };

  const findEventAfter = SqlSchema.findOneOption({
    Request: HasEventAfterRequestSchema,
    Result: Schema.Struct({ sequence: Schema.Number }),
    execute: (request) => sql`
          SELECT sequence
          FROM orchestration_events
          WHERE aggregate_kind = ${request.aggregateKind}
            AND stream_id = ${request.aggregateId}
            AND ${sql.and([
              sql`sequence > ${request.sequenceExclusive}`,
              ...(request.type === undefined ? [] : [sql`event_type = ${request.type}`]),
            ])}
          LIMIT 1
        `,
  });

  const hasEventAfter: OrchestrationEventStoreShape["hasEventAfter"] = (input) =>
    findEventAfter(input).pipe(
      Effect.map(Option.isSome),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "OrchestrationEventStore.hasEventAfter:query",
          "OrchestrationEventStore.hasEventAfter:decodeRow",
        ),
      ),
    );

  const readAggregateRange: OrchestrationEventStoreShape["readAggregateRange"] = (input) => {
    const limit = Math.max(0, Math.floor(input.limit ?? DEFAULT_READ_FROM_SEQUENCE_LIMIT));
    if (limit === 0 || input.fromSequenceExclusive >= input.toSequenceInclusive) {
      return Stream.empty;
    }
    return Stream.paginate(
      { cursor: input.fromSequenceExclusive, remaining: limit },
      ({ cursor, remaining }) => {
        // One binding for the SQL limit and the stop test below, which compare
        // against each other: a short page means the aggregate has no more
        // rows in range, and a stop test reading READ_PAGE_SIZE while the
        // query asked for `remaining` ends a full last page one read early.
        const pageLimit = Math.min(remaining, READ_PAGE_SIZE);
        return readAggregateEventRows({
          ...input,
          fromSequenceExclusive: cursor,
          limit: pageLimit,
        }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              "OrchestrationEventStore.readAggregateRange:query",
              "OrchestrationEventStore.readAggregateRange:decodeRows",
            ),
          ),
          Effect.flatMap((rows) =>
            decodeRowsSkippingUnknownTypes(
              rows,
              "OrchestrationEventStore.readAggregateRange:rowToEvent",
            ).pipe(
              Effect.map((events) => {
                // The stop test counts ROWS READ, not events decoded. A page
                // whose rows were all skipped yields no events and must still
                // advance: the input is a page filled by unknown rows with a
                // known row after them.
                const lastRow = rows.at(-1);
                const nextRemaining = remaining - events.length;
                return [
                  events,
                  lastRow === undefined ||
                  rows.length < pageLimit ||
                  nextRemaining <= 0 ||
                  lastRow.sequence >= input.toSequenceInclusive
                    ? Option.none()
                    : Option.some({ cursor: lastRow.sequence, remaining: nextRemaining }),
                ] as const;
              }),
            ),
          ),
        );
      },
    );
  };

  const getAggregateReplayStats: OrchestrationEventStoreShape["getAggregateReplayStats"] = (
    input,
  ) =>
    readAggregateReplayStats({
      ...input,
      limit: Math.max(0, Math.floor(input.maxEvents)) + 1,
    }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "OrchestrationEventStore.getAggregateReplayStats:query",
          "OrchestrationEventStore.getAggregateReplayStats:decodeRow",
        ),
      ),
      Effect.map((row) => ({ ...row, hasCreateEvent: row.hasCreateEvent !== 0 })),
    );

  return {
    append,
    readFromSequence,
    readAggregateRange,
    getAggregateReplayStats,
    readAll: () => readFromSequence(0, Number.MAX_SAFE_INTEGER),
    hasEventAfter,
  } satisfies OrchestrationEventStoreShape;
});

export const OrchestrationEventStoreLive = Layer.effect(OrchestrationEventStore, makeEventStore);
