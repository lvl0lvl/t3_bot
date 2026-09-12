/**
 * ProjectionStateRepository - Projection repository interface for projector cursors.
 *
 * Owns persistence operations for projection cursor state used to resume
 * incremental event projection.
 *
 * Reactors that must not miss events keep their cursor here too, under a
 * `reactor:` prefix. The rows are the same thing — a named position in the
 * event log — so one table answers "what is the oldest position anything still
 * needs", rather than two tables of identical shape that a future reader has to
 * know to consult both of.
 *
 * `minLastAppliedSequence` is what that question would be asked through, and it
 * has NO production consumer today: there is no event-log pruner in the server.
 * Written as a reason rather than as a mechanism, because the earlier version of
 * this paragraph said a pruning floor "covers both" in the present tense and
 * described something that does not exist.
 *
 * @module ProjectionStateRepository
 */
import { IsoDateTime, NonNegativeInt } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionState = Schema.Struct({
  projector: Schema.String,
  lastAppliedSequence: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type ProjectionState = typeof ProjectionState.Type;

export const GetProjectionStateInput = Schema.Struct({
  projector: Schema.String,
});
export type GetProjectionStateInput = typeof GetProjectionStateInput.Type;

/**
 * ProjectionStateRepositoryShape - Service API for projector state records.
 */
export interface ProjectionStateRepositoryShape {
  /**
   * Insert or replace a projection cursor row.
   *
   * Upserts by projector name.
   */
  readonly upsert: (row: ProjectionState) => Effect.Effect<void, ProjectionRepositoryError>;

  /** Insert or replace projector cursors in one statement. Empty batches do nothing. */
  readonly upsertMany: (
    rows: ReadonlyArray<ProjectionState>,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Read projection cursor state for a projector key.
   */
  readonly getByProjector: (
    input: GetProjectionStateInput,
  ) => Effect.Effect<Option.Option<ProjectionState>, ProjectionRepositoryError>;

  /**
   * List all projector cursor rows.
   */
  readonly listAll: () => Effect.Effect<ReadonlyArray<ProjectionState>, ProjectionRepositoryError>;

  /**
   * Read the minimum applied sequence across all projectors.
   *
   * Returns `null` when no projector state rows exist.
   */
  readonly minLastAppliedSequence: () => Effect.Effect<number | null, ProjectionRepositoryError>;
}

/**
 * ProjectionStateRepository - Service tag for projection cursor persistence.
 */
export class ProjectionStateRepository extends Context.Service<
  ProjectionStateRepository,
  ProjectionStateRepositoryShape
>()("t3/persistence/Services/ProjectionState/ProjectionStateRepository") {}
