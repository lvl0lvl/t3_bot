import { NonNegativeInt } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  NewProjectionDecoderEpoch,
  ProjectionDecoderEpoch,
  ProjectionDecoderRepository,
  type ProjectionDecoderRepositoryShape,
  ProjectionHole,
  ProjectionHoleQuery,
} from "../Services/ProjectionDecoder.ts";

const StringListFromJson = Schema.fromJsonString(Schema.Array(Schema.String));

// The lists cross the sqlite boundary as JSON text; the schema does the
// encoding both ways so no hand-written JSON touches the row.
// A row whose event_types_json or aggregate_kinds_json is not a JSON array of
// strings FAILS THE READ, and `listEpochs` is the first thing a bootstrap
// calls, so the server does not start. Deliberate: a row of a known shape that
// its own schema refuses is corruption of the same file the event log lives in,
// and reading past it would silently rebuild every projection on every boot
// while hiding the corruption that caused it.
const ProjectionDecoderEpochRow = Schema.Struct({
  ...ProjectionDecoderEpoch.fields,
  eventTypes: StringListFromJson,
  aggregateKinds: StringListFromJson,
});

const NewProjectionDecoderEpochRow = Schema.Struct({
  ...NewProjectionDecoderEpoch.fields,
  eventTypes: StringListFromJson,
  aggregateKinds: StringListFromJson,
});

const ExtendEpochInput = Schema.Struct({
  epoch: NonNegativeInt,
  endedAtSequence: NonNegativeInt,
});

const CoverEpochInput = Schema.Struct({
  epoch: NonNegativeInt,
  eventTypes: StringListFromJson,
  aggregateKinds: StringListFromJson,
});

const makeProjectionDecoderRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listEpochRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionDecoderEpochRow,
    execute: () =>
      sql`
        SELECT
          epoch,
          event_types_json AS "eventTypes",
          aggregate_kinds_json AS "aggregateKinds",
          started_at_sequence AS "startedAtSequence",
          ended_at_sequence AS "endedAtSequence"
        FROM projection_decoder
        ORDER BY epoch ASC
      `,
  });

  // Unindexed on event_type and aggregate_kind: it runs once per epoch that
  // lacks part of this build's lists, over that epoch's range. A clean scan is
  // then written back into the epoch's lists, so the epoch's delta is empty on
  // every later boot and this query does not run for it again.
  const findHoleRow = SqlSchema.findOneOption({
    Request: ProjectionHoleQuery,
    Result: ProjectionHole,
    execute: (query) =>
      sql`
        SELECT
          sequence,
          event_type AS "eventType",
          aggregate_kind AS "aggregateKind"
        FROM orchestration_events
        WHERE sequence > ${query.afterSequence}
          AND sequence <= ${query.throughSequence}
          AND (
            ${query.eventTypes.length === 0 ? sql`FALSE` : sql.in("event_type", query.eventTypes)}
            OR ${query.aggregateKinds.length === 0 ? sql`FALSE` : sql.in("aggregate_kind", query.aggregateKinds)}
          )
        ORDER BY sequence ASC
        LIMIT 1
      `,
  });

  const insertEpochRow = SqlSchema.void({
    Request: NewProjectionDecoderEpochRow,
    execute: (row) =>
      sql`
        INSERT INTO projection_decoder (
          event_types_json,
          aggregate_kinds_json,
          started_at_sequence,
          ended_at_sequence
        )
        VALUES (
          ${row.eventTypes},
          ${row.aggregateKinds},
          ${row.startedAtSequence},
          ${row.endedAtSequence}
        )
      `,
  });

  const extendEpochRow = SqlSchema.void({
    Request: ExtendEpochInput,
    execute: (input) =>
      sql`
        UPDATE projection_decoder
        SET ended_at_sequence = ${input.endedAtSequence}
        WHERE epoch = ${input.epoch}
      `,
  });

  const coverEpochRow = SqlSchema.void({
    Request: CoverEpochInput,
    execute: (input) =>
      sql`
        UPDATE projection_decoder
        SET event_types_json = ${input.eventTypes},
            aggregate_kinds_json = ${input.aggregateKinds}
        WHERE epoch = ${input.epoch}
      `,
  });

  const listEpochs: ProjectionDecoderRepositoryShape["listEpochs"] = () =>
    listEpochRows(undefined).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionDecoderRepository.listEpochs:query")),
    );

  const findHole: ProjectionDecoderRepositoryShape["findHole"] = (query) =>
    findHoleRow(query).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionDecoderRepository.findHole:query")),
    );

  const appendEpoch: ProjectionDecoderRepositoryShape["appendEpoch"] = (epoch) =>
    insertEpochRow(epoch).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionDecoderRepository.appendEpoch:query")),
    );

  const extendEpoch: ProjectionDecoderRepositoryShape["extendEpoch"] = (input) =>
    extendEpochRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionDecoderRepository.extendEpoch:query")),
    );

  const coverEpoch: ProjectionDecoderRepositoryShape["coverEpoch"] = (input) =>
    coverEpochRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionDecoderRepository.coverEpoch:query")),
    );

  const deleteAllEpochs: ProjectionDecoderRepositoryShape["deleteAllEpochs"] = () =>
    sql`DELETE FROM projection_decoder`.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ProjectionDecoderRepository.deleteAllEpochs:query")),
    );

  return {
    listEpochs,
    findHole,
    appendEpoch,
    extendEpoch,
    coverEpoch,
    deleteAllEpochs,
  } satisfies ProjectionDecoderRepositoryShape;
});

export const ProjectionDecoderRepositoryLive = Layer.effect(
  ProjectionDecoderRepository,
  makeProjectionDecoderRepository,
);
