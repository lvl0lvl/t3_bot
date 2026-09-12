/**
 * MentionWakeReactor - turns a channel mention into an agent turn.
 *
 * A post that mentions a thread member must wake that thread. The cost of
 * missing one is the failure the comms toolkit is built around: a message that
 * never wakes anyone, indistinguishable to its author from a delivered one. So
 * this reactor does not simply subscribe — it keeps a durable cursor and
 * replays what it has not seen, because the engine's PubSub delivers only to
 * subscribers attached at publish time and publishes AFTER the transaction
 * commits. An event can be durable and never published.
 *
 * @module MentionWakeReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

/** The cursor's name in `projection_state`. See ProjectionStateRepository. */
export const MENTION_WAKE_CURSOR = "reactor:mention-wake";

export interface MentionWakeReactorShape {
  /**
   * Begin waking threads on `channel.post-created`.
   *
   * Subscribes BEFORE reading the backlog so an event published between the
   * two is seen by the subscription rather than falling between them, and
   * de-duplicates the overlap by sequence.
   *
   * Must be run in a scope so the worker fiber is finalized on shutdown.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves once every post at or before `sequence` has been handed to the
   * worker and the worker is idle. The fence a test waits on instead of a
   * sleep.
   *
   * TWO EDGES, both of which have bitten:
   *
   * It is NOT a fence at or below the resume point. `start` seeds the fence
   * there, so a target the previous run already passed resolves immediately,
   * without this run reading an event. Nothing can be OWED below that point, so
   * it cannot hide a missed wake - but an assertion shaped "after a restart, X
   * happened" at such a target passes without waiting for anything. Wait on a
   * sequence this run must actually reach.
   *
   * And it hangs forever if `start` has not run, rather than failing: `start`
   * is what seeds the fence, and a fence that was never seeded is a wait for a
   * value nothing will publish.
   */
  readonly drainThrough: (sequence: number) => Effect.Effect<void>;
}

export class MentionWakeReactor extends Context.Service<
  MentionWakeReactor,
  MentionWakeReactorShape
>()("t3/orchestration/Services/MentionWakeReactor") {}
