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

const OrchestrationEventReadRowSchema = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: EventId,
  // Plain strings, not the closed unions: a row written by a newer build
  // carries a type, an aggregate kind and an id shape this build does not
  // know, and the read decides per row whether to skip it (unknown type or
  // kind) or fail (known type and kind, refused payload). 8660c7933c is the
  // input: a new aggregate kind and its event types arrive in one change, so a
  // closed kind union here refuses the whole page before any row is judged.
  type: Schema.String,
  aggregateKind: Schema.String,
  aggregateId: Schema.String,
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  payload: UnknownFromJsonString,
  metadata: EventMetadataFromJsonString,
});

const isKnownEventType = Schema.is(OrchestrationEventType);
const isKnownAggregateKind = Schema.is(OrchestrationAggregateKind);

// A row whose type is outside this build's union was written by a newer build.
// The read skips it and logs one warning per row per read, and keeps failing
// on a KNOWN type whose payload its schema refuses: that is corruption, and
// reading past it would hide data loss. DISCLOSED: a skipped event leaves every
// later known event applied to a state that is missing its effect (a newer
// build's event that a later known event depends on); that is the cost of an
// older build reading a newer log, and the alternative was a server that
// cannot start on it. DISCLOSED: the warning is per row and uncapped, so a
// log with many unknown rows logs one line each on every replay.
const decodeRowsSkippingUnknownTypes = (
  rows: ReadonlyArray<typeof OrchestrationEventReadRowSchema.Type>,
  operation: string,
) =>
  Effect.forEach(rows, (row) => {
    const { type, aggregateKind, ...rest } = row;
    const unknown = !isKnownAggregateKind(aggregateKind)
      ? { what: "aggregate kind", value: aggregateKind }
      : !isKnownEventType(type)
        ? { what: "type", value: type }
        : undefined;
    if (unknown !== undefined) {
      return Effect.logWarning(
        `orchestration event skipped: unknown ${unknown.what} ${unknown.value} at sequence ${row.sequence}`,
      ).pipe(
        Effect.annotateLogs({
          sequence: row.sequence,
          type,
          aggregateKind,
          aggregateId: row.aggregateId,
          occurredAt: row.occurredAt,
        }),
        Effect.as(Option.none<OrchestrationEvent>()),
      );
    }
    return decodeEvent({ ...rest, aggregateKind, type }).pipe(
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
      ({ cursor, remaining }) =>
        readAggregateEventRows({
          ...input,
          fromSequenceExclusive: cursor,
          limit: Math.min(remaining, READ_PAGE_SIZE),
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
                const lastRow = rows.at(-1);
                const nextRemaining = remaining - events.length;
                return [
                  events,
                  lastRow === undefined ||
                  rows.length < Math.min(remaining, READ_PAGE_SIZE) ||
                  nextRemaining <= 0 ||
                  lastRow.sequence >= input.toSequenceInclusive
                    ? Option.none()
                    : Option.some({ cursor: lastRow.sequence, remaining: nextRemaining }),
                ] as const;
              }),
            ),
          ),
        ),
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
