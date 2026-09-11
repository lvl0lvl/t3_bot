import type { ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ChannelGateway from "./channelGateway.ts";
import {
  CommsChannelNotFoundError,
  CommsMemberNotFoundError,
  CommsMembershipLostError,
  CommsPostFailedError,
  CommsPostNotFoundError,
  CommsReadFailedError,
  CommsToolkit,
  DEFAULT_READ_LIMIT,
  type PostResult,
  type ReadChannelResult,
} from "./tools.ts";

/**
 * Agents write "#seniors" and "seniors" interchangeably, and the sigil can hide
 * whitespace, so the trim runs on both sides of the strip. A name that is only
 * sigils and spaces normalizes to empty and must be rejected rather than looked
 * up.
 */
export const normalizeChannelName = (name: string): string => name.trim().replace(/^#+/, "").trim();

/** Same for "@boss1" and "boss1". */
const normalizeHandle = (handle: string): string => handle.trim().replace(/^@+/, "").trim();

/**
 * Mentions the agent asked for, resolved against the channel's membership, with
 * duplicates collapsed.
 *
 * Unknown handles are an error rather than a silent drop: a mention that does
 * not resolve is a message that never wakes anyone, and the agent would have no
 * way to tell that from a delivered one. It reports every bad handle at once so
 * a retry does not discover them one at a time.
 *
 * Both sides of the comparison are normalized, and the NORMALIZED handle is
 * what is emitted — keying on one form and emitting another lets two members
 * whose handles differ only by a sigil collapse into one entry and resolve a
 * mention to the wrong member.
 */
export function resolveMentions(
  requested: ReadonlyArray<string>,
  members: ReadonlyArray<ChannelGateway.ChannelMember>,
): { readonly handles: ReadonlyArray<string> } | { readonly unknown: ReadonlyArray<string> } {
  const byHandle = new Map(
    members.map((member) => [normalizeHandle(member.handle), member] as const),
  );
  const handles: Array<string> = [];
  const unknown: Array<string> = [];
  const seenHandles = new Set<string>();
  const seenUnknown = new Set<string>();
  for (const entry of requested) {
    const handle = normalizeHandle(entry);
    if (handle.length === 0) continue;
    if (byHandle.has(handle)) {
      if (!seenHandles.has(handle)) {
        seenHandles.add(handle);
        handles.push(handle);
      }
    } else if (!seenUnknown.has(handle)) {
      seenUnknown.add(handle);
      unknown.push(handle);
    }
  }
  return unknown.length > 0 ? { unknown } : { handles };
}

const make = Effect.gen(function* () {
  const channels = yield* ChannelGateway.ChannelGateway;

  /**
   * Maps the gateway's declared failures onto tool errors, one tag at a time.
   * Naming each tag is what makes a later widening of the gateway's error
   * channel a compile error here rather than a silent flattening.
   */
  const storeUnavailableAsRead = {
    ChannelStoreUnavailable: (error: ChannelGateway.ChannelStoreUnavailable) =>
      Effect.fail(new CommsReadFailedError({ detail: error.detail })),
  } as const;

  const storeUnavailableAsWrite = {
    ChannelStoreUnavailable: (error: ChannelGateway.ChannelStoreUnavailable) =>
      Effect.fail(new CommsPostFailedError({ detail: error.detail, retryable: false })),
  } as const;

  const onCreateFailure = {
    ChannelStoreUnavailable: (error: ChannelGateway.ChannelStoreUnavailable) =>
      Effect.fail(new CommsPostFailedError({ detail: error.detail, retryable: false })),
    ChannelWriteConflict: (error: ChannelGateway.ChannelWriteConflict) =>
      Effect.fail(new CommsPostFailedError({ detail: error.detail, retryable: true })),
    ChannelMembershipRevoked: () => Effect.fail(new CommsMembershipLostError()),
    ChannelMentionUnresolvable: (error: ChannelGateway.ChannelMentionUnresolvable) =>
      Effect.fail(new CommsMemberNotFoundError({ handles: error.handles })),
  } as const;

  /**
   * A defect from the gateway is a bug in this server, not something the agent
   * did. It still has to reach the agent as a failed tool call rather than an
   * unhandled crash, so it is mapped here — separately from the typed failures
   * above, which is what keeps the tag mapping exhaustive.
   */
  const onDefect =
    (make: (detail: string) => CommsPostFailedError | CommsReadFailedError) =>
    <E>(
      cause: Cause.Cause<E>,
    ): Effect.Effect<never, E | CommsPostFailedError | CommsReadFailedError> =>
      // Only a defect is converted. A typed failure passes through untouched —
      // catching it here would re-wrap the error the tag mapping just produced
      // and undo the whole point of naming each tag.
      Cause.hasFails(cause) || Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.fail(make(Cause.pretty(cause)));

  const readDefect = onDefect((detail) => new CommsReadFailedError({ detail }));
  const writeDefect = onDefect((detail) => new CommsPostFailedError({ detail, retryable: false }));

  /**
   * The channel named, proven to have the calling thread as a member. Every
   * tool starts here, so membership is enforced once, on the credential's
   * thread, and no tool can act on a channel the caller is not in.
   */
  const requireChannel = Effect.fn("CommsToolkit.requireChannel")(function* (
    name: string,
    isWrite: boolean,
  ) {
    const scope = yield* McpInvocationContext.requireMcpCapability("comms");
    const normalized = normalizeChannelName(name);
    if (normalized.length === 0) {
      return yield* new CommsChannelNotFoundError({ channel: normalized });
    }
    const channel = yield* channels
      .getChannelForMember(normalized, scope.threadId)
      .pipe(
        Effect.catchTags(isWrite ? storeUnavailableAsWrite : storeUnavailableAsRead),
        Effect.catchCause(isWrite ? writeDefect : readDefect),
      );
    if (Option.isNone(channel)) {
      return yield* new CommsChannelNotFoundError({ channel: normalized });
    }
    return { channel: channel.value, threadId: scope.threadId };
  });

  /** Writes a post to an already-resolved channel. */
  const publish = Effect.fn("CommsToolkit.publish")(function* (input: {
    readonly channel: ChannelGateway.Channel;
    readonly threadId: ThreadId;
    readonly body: string;
    readonly mentions: ReadonlyArray<string> | undefined;
    readonly parentPostId: string | null;
  }) {
    const resolved = resolveMentions(input.mentions ?? [], input.channel.members);
    if ("unknown" in resolved) {
      return yield* new CommsMemberNotFoundError({ handles: resolved.unknown });
    }
    const created = yield* channels
      .createPost({
        channelId: input.channel.channelId,
        authorRef: { memberKind: "thread", memberId: input.threadId },
        body: input.body.trim(),
        mentions: resolved.handles,
        parentPostId: input.parentPostId,
      })
      .pipe(Effect.catchTags(onCreateFailure), Effect.catchCause(writeDefect));
    return {
      postId: created.postId,
      channel: input.channel.name,
      createdAt: created.createdAt,
      mentioned: resolved.handles,
    } satisfies PostResult;
  });

  return CommsToolkit.of({
    comms_post: (input) =>
      Effect.gen(function* () {
        const { channel, threadId } = yield* requireChannel(input.channel, true);
        return yield* publish({
          channel,
          threadId,
          body: input.body,
          mentions: input.mentions,
          parentPostId: null,
        });
      }),

    comms_reply: (input) =>
      Effect.gen(function* () {
        // One resolution per call: validating the parent against a different
        // resolution than the post is written to would let the two disagree.
        const { channel, threadId } = yield* requireChannel(input.channel, true);
        // A direct lookup, not a page scan — a lookback bounded by a page size
        // silently refuses replies to anything outside it.
        const parent = yield* channels
          .getPost(channel.channelId, input.parentPostId)
          .pipe(Effect.catchTags(storeUnavailableAsWrite), Effect.catchCause(writeDefect));
        if (Option.isNone(parent)) {
          return yield* new CommsPostNotFoundError({ postId: input.parentPostId });
        }
        return yield* publish({
          channel,
          threadId,
          body: input.body,
          mentions: input.mentions,
          parentPostId: input.parentPostId,
        });
      }),

    comms_read_channel: (input) =>
      Effect.gen(function* () {
        const { channel } = yield* requireChannel(input.channel, false);
        const page = yield* channels
          .readPosts({
            channelId: channel.channelId,
            // The 1..200 range is enforced by the tool schema; clamping again
            // here would be a second, silently-diverging control.
            limit: input.limit ?? DEFAULT_READ_LIMIT,
            cursor: input.cursor,
          })
          .pipe(Effect.catchTags(storeUnavailableAsRead), Effect.catchCause(readDefect));
        return {
          channel: channel.name,
          members: channel.members.map((member) => member.handle),
          posts: page.posts.map((post) => ({
            postId: post.postId,
            author: post.authorHandle,
            body: post.body,
            mentions: post.mentions,
            parentPostId: post.parentPostId,
            createdAt: post.createdAt,
          })),
          nextCursor: page.nextCursor,
        } satisfies ReadChannelResult;
      }),
  });
});

export const CommsToolkitHandlersLive = CommsToolkit.toLayer(make);
