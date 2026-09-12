import { CommandId, MessageId, ThreadId, type OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { ProjectionChannelRepository } from "../../persistence/Services/ProjectionChannels.ts";
import { ProjectionStateRepository } from "../../persistence/Services/ProjectionState.ts";
import { ProjectionThreadRepository } from "../../persistence/Services/ProjectionThreads.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { forkParked } from "../../serverActivation.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  MentionWakeReactor,
  MENTION_WAKE_CURSOR,
  type MentionWakeReactorShape,
} from "../Services/MentionWakeReactor.ts";

type PostCreated = Extract<OrchestrationEvent, { type: "channel.post-created" }>;

/**
 * One wake per (channel, post, thread), derived rather than generated.
 *
 * The channel is part of the key because a post id is only unique WITHIN a
 * channel — it is caller-supplied, and the projection is keyed
 * `(channel_id, post_id)` for exactly that reason. Without it two legal posts
 * in different channels derive one CommandId and the engine's receipt check
 * absorbs the second as a replay: a real mention, silently never delivered.
 *
 * The engine's receipt idempotency turns a replayed command into a no-op, so
 * at-least-once delivery plus a derived id is exactly-once in effect. That is
 * what lets the cursor be written AFTER the dispatch in its own transaction: a
 * crash between the two replays the post on restart and the replay is absorbed.
 */
const wakeKey = (channelId: string, postId: string, threadId: ThreadId) =>
  `comms-wake:${channelId}:${postId}:${threadId}`;

/**
 * The prompt a woken agent sees. The first line is machine-parseable so a
 * client can render it as a channel card and correlate by postId.
 *
 * The footer is not decoration: without it an agent answers a colleague's
 * broadcast as though its own operator had asked, in a thread nobody in the
 * channel can read.
 */
const wakeMessageText = (input: {
  readonly channelName: string;
  readonly authorHandle: string;
  readonly postId: string;
  readonly parentPostId: string | null;
  readonly body: string;
}) => {
  const inReplyTo = input.parentPostId === null ? "" : ` · in reply to ${input.parentPostId}`;
  return [
    `[comms] #${input.channelName} · @${input.authorHandle} mentioned you · post ${input.postId}${inReplyTo}`,
    "",
    input.body,
    "",
    "This is a channel post, not a message from this thread's operator. Reply in the channel:",
    `comms_reply(channel: "${input.channelName}", parentPostId: "${input.postId}", body: ...) — or comms_post to start a new thread there.`,
    "Do not answer here; nobody in the channel can see this thread.",
  ].join("\n");
};

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const eventStore = yield* OrchestrationEventStore;
  const projectionState = yield* ProjectionStateRepository;
  const channels = yield* ProjectionChannelRepository;
  const threads = yield* ProjectionThreadRepository;

  /**
   * Every thread member the post named, resolved against the channel's CURRENT
   * membership rather than against the event.
   *
   * A member removed between the post and the wake is not woken: the message
   * lives in a channel they can no longer read. Mentions are matched exactly,
   * because the aggregate stores handles canonically and the event carries what
   * it stored.
   */
  const targetThreads = Effect.fn("MentionWakeReactor.targetThreads")(function* (
    event: PostCreated,
  ) {
    const channel = yield* channels.getChannelById(event.payload.channelId);
    if (Option.isNone(channel)) {
      return { channelName: null, threadIds: [] as ReadonlyArray<ThreadId> };
    }
    const mentioned = new Set<string>(event.payload.mentions);
    const threadIds = [
      ...new Set(
        channel.value.members
          .filter(
            (member) =>
              member.memberKind === "thread" &&
              mentioned.has(member.handle) &&
              // Never the author. An agent does not need telling about its own
              // post, and waking it would be a turn that starts itself: the
              // woken agent is told to reply in the channel, and a reply that
              // mentions its own handle wakes it again, forever, with each
              // cycle costing a real turn.
              !(
                event.payload.authorRef.memberKind === "thread" &&
                event.payload.authorRef.memberId === member.memberId
              ),
          )
          .map((member) => member.memberId),
      ),
    ].map((memberId) => ThreadId.make(memberId));
    return { channelName: channel.value.name, threadIds };
  });

  const wake = Effect.fn("MentionWakeReactor.wake")(function* (event: PostCreated) {
    const { channelName, threadIds } = yield* targetThreads(event);
    if (channelName === null || threadIds.length === 0) {
      return;
    }
    const text = wakeMessageText({
      channelName,
      authorHandle: event.payload.authorHandle,
      postId: event.payload.postId,
      parentPostId: event.payload.parentPostId,
      body: event.payload.body,
    });
    for (const threadId of threadIds) {
      // The woken turn runs in the thread's OWN modes, read now rather than
      // defaulted. A channel mention must not be a way to raise a thread's
      // runtime mode: an operator who set a thread to approval-required did not
      // consent to a colleague's post running it with full access. Defaulting
      // would do exactly that, silently, from outside the thread.
      const thread = yield* threads.getById({ threadId });
      if (Option.isNone(thread)) {
        continue;
      }
      const key = wakeKey(event.payload.channelId, event.payload.postId, threadId);
      yield* engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make(key),
        threadId,
        message: {
          messageId: MessageId.make(key),
          role: "user",
          text,
          attachments: [],
        },
        runtimeMode: thread.value.runtimeMode,
        interactionMode: thread.value.interactionMode,
        createdAt: event.payload.createdAt,
      });
    }
  });

  /**
   * A failure to wake one post must not stop the reactor waking the next. It
   * is logged at warning rather than debug because the consequence is an agent
   * that never answers, which nothing downstream will notice.
   */
  const wakeSafely = (event: PostCreated) =>
    wake(event).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("mention wake skipped", {
              postId: event.payload.postId,
              channelId: event.payload.channelId,
              cause: Cause.pretty(cause),
            }),
      ),
    );

  /**
   * The worker owns the cursor, and that is the whole point of it being here
   * rather than in the stream.
   *
   * The worker is a separate fiber over an in-memory queue, interrupted when
   * the scope closes. Advancing the cursor when the event was READ means a
   * shutdown — SIGTERM, not only a crash — discards a queue whose posts the
   * cursor already claims, and those wakes are lost FOREVER: the post is never
   * replayed, so the derived commandId never gets the chance to absorb
   * anything. Advancing after the wake makes the cursor lag, and lagging is
   * exactly what the derived id makes free.
   *
   * Every event goes through here, not just the ones that wake somebody,
   * because the cursor has to move past the others too.
   */
  const processEvent = (event: OrchestrationEvent) =>
    Effect.gen(function* () {
      if (event.type === "channel.post-created" && event.payload.mentions.length > 0) {
        yield* wakeSafely(event);
      }
      yield* advance(event).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("mention wake cursor not advanced", {
                sequence: event.sequence,
                cause: Cause.pretty(cause),
              }),
        ),
      );
    });

  const worker = yield* makeDrainableWorker(processEvent);

  const seenSequence = yield* SubscriptionRef.make(0);
  const noteSeen = (sequence: number) =>
    SubscriptionRef.update(seenSequence, (seen) => Math.max(seen, sequence));

  /**
   * Where to resume from, and the one case where "start at the head" is right.
   *
   * A MISSING row means this reactor has never run, so nothing before now was
   * ever owed a wake — on a database that already holds channel posts, starting
   * at zero would wake every agent mentioned in its whole history, at once. A
   * row that cannot be READ is a different thing entirely and must not be
   * treated as absence: seeding at the head there would silently skip every
   * event between the real cursor and now. The read failure therefore fails
   * startup rather than guessing.
   */
  const resumeFrom = Effect.fn("MentionWakeReactor.resumeFrom")(function* () {
    const existing = yield* projectionState.getByProjector({ projector: MENTION_WAKE_CURSOR });
    if (Option.isSome(existing)) {
      return existing.value.lastAppliedSequence;
    }
    const head = yield* engine.latestSequence;
    yield* projectionState.upsert({
      projector: MENTION_WAKE_CURSOR,
      lastAppliedSequence: head,
      updatedAt: DateTime.formatIso(yield* DateTime.now),
    });
    return head;
  });

  const advance = (event: OrchestrationEvent) =>
    projectionState.upsert({
      projector: MENTION_WAKE_CURSOR,
      lastAppliedSequence: event.sequence,
      updatedAt: event.occurredAt,
    });

  const handle = (event: OrchestrationEvent) =>
    Effect.gen(function* () {
      yield* worker.enqueue(event);
      yield* noteSeen(event.sequence);
    });

  const start: MentionWakeReactorShape["start"] = Effect.fn("start")(function* () {
    // Subscribe BEFORE reading the backlog. An event published between the two
    // arrives on the subscription instead of falling into the gap; the overlap
    // is removed by the sequence filter below rather than by timing.
    const live = yield* engine.subscribeDomainEvents;
    const from = yield* resumeFrom().pipe(Effect.orDie);
    // Everything at or below the resume point was handled by a previous run, so
    // the fence starts there rather than at zero. Without this a caller waiting
    // on an older sequence waits forever for an event this run will never see.
    yield* noteSeen(from);
    let handled = from;
    yield* forkParked(
      Stream.runForEach(
        Stream.concat(eventStore.readFromSequence(from, Number.MAX_SAFE_INTEGER), live),
        (event) => {
          if (event.sequence <= handled) {
            return Effect.void;
          }
          handled = event.sequence;
          return handle(event);
        },
      ).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logError("mention wake reactor stopped", { cause: Cause.pretty(cause) }),
        ),
      ),
    );
  });

  const drainThrough: MentionWakeReactorShape["drainThrough"] = Effect.fn(
    "MentionWakeReactor.drainThrough",
  )(function* (target) {
    yield* SubscriptionRef.changes(seenSequence).pipe(
      Stream.filter((seen) => seen >= target),
      Stream.runHead,
    );
    yield* worker.drain;
  });

  return { start, drainThrough } satisfies MentionWakeReactorShape;
});

export const MentionWakeReactorLive = Layer.effect(MentionWakeReactor, make);
