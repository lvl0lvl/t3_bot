/**
 * ProjectionDecoderRepository - the decoder epoch ledger.
 *
 * Migration 054 carries why the table exists and why it holds one row per
 * epoch rather than one row overwritten; this file is the access to it.
 *
 * The rows are a CHAIN, not a set of independent claims: each epoch's range
 * begins where the previous one ended, and a range only ever widens. The
 * pipeline opens an epoch BEFORE it replays and widens it after, so a crash
 * leaves an end understated and never overstated, and an understated end is
 * repaired on the next boot by extending it to the projectors' watermark. The
 * input that breaks the chain is a second writer on one database: two builds
 * sharing a T3 home would each attribute the other's rows to their own epoch.
 *
 * @module ProjectionDecoderRepository
 */
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

  /**
   * Replace one epoch's lists with the given ones.
   *
   * Called when a scan of that epoch's range came back clean: no row of the
   * types it lacked exists there, so recording the larger lists is a true
   * statement about the range and the next boot's delta for it is empty.
   *
   * Called on an epoch that was NOT scanned, or was scanned over a narrower
   * range than it now spans, it writes a false statement and hole detection is
   * silently disabled for that range for the life of the database: no later
   * build will ever see a delta there again.
   */
  readonly coverEpoch: (input: {
    readonly epoch: number;
    readonly eventTypes: ReadonlyArray<string>;
    readonly aggregateKinds: ReadonlyArray<string>;
  }) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Drop every epoch.
   *
   * Only a rebuild may call this, and only in the transaction that empties the
   * projection tables and opens this build's epoch at (0, 0]. Called anywhere
   * else it disables hole detection for the whole log: the ranges every older
   * build applied are gone, so no later build can know which of them lacked a
   * type, and the scan has nothing left to look at.
   */
  readonly deleteAllEpochs: () => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionDecoderRepository extends Context.Service<
  ProjectionDecoderRepository,
  ProjectionDecoderRepositoryShape
>()("t3/persistence/Services/ProjectionDecoder/ProjectionDecoderRepository") {}
