import { NonNegativeInt } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

/**
 * One decoder epoch: the event types and aggregate kinds a build could
 * decode, and the watermark range (startedAtSequence, endedAtSequence] it
 * applied the projectors over with those lists. See migration 054.
 */
export const ProjectionDecoderEpoch = Schema.Struct({
  epoch: NonNegativeInt,
  eventTypes: Schema.Array(Schema.String),
  aggregateKinds: Schema.Array(Schema.String),
  startedAtSequence: NonNegativeInt,
  endedAtSequence: NonNegativeInt,
});
export type ProjectionDecoderEpoch = typeof ProjectionDecoderEpoch.Type;

export const NewProjectionDecoderEpoch = Schema.Struct({
  eventTypes: Schema.Array(Schema.String),
  aggregateKinds: Schema.Array(Schema.String),
  startedAtSequence: NonNegativeInt,
  endedAtSequence: NonNegativeInt,
});
export type NewProjectionDecoderEpoch = typeof NewProjectionDecoderEpoch.Type;

export const ProjectionHoleQuery = Schema.Struct({
  eventTypes: Schema.Array(Schema.String),
  aggregateKinds: Schema.Array(Schema.String),
  afterSequence: NonNegativeInt,
  throughSequence: NonNegativeInt,
});
export type ProjectionHoleQuery = typeof ProjectionHoleQuery.Type;

export const ProjectionHole = Schema.Struct({
  sequence: NonNegativeInt,
  eventType: Schema.String,
  aggregateKind: Schema.String,
});
export type ProjectionHole = typeof ProjectionHole.Type;

export interface ProjectionDecoderRepositoryShape {
  readonly listEpochs: () => Effect.Effect<
    ReadonlyArray<ProjectionDecoderEpoch>,
    ProjectionRepositoryError
  >;

  /** The lowest-sequence row in (afterSequence, throughSequence] whose type or kind is listed. */
  readonly findHole: (
    query: ProjectionHoleQuery,
  ) => Effect.Effect<Option.Option<ProjectionHole>, ProjectionRepositoryError>;

  readonly appendEpoch: (
    epoch: NewProjectionDecoderEpoch,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly extendEpoch: (input: {
    readonly epoch: number;
    readonly endedAtSequence: number;
  }) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly deleteAllEpochs: () => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionDecoderRepository extends Context.Service<
  ProjectionDecoderRepository,
  ProjectionDecoderRepositoryShape
>()("t3/persistence/Services/ProjectionDecoder/ProjectionDecoderRepository") {}
