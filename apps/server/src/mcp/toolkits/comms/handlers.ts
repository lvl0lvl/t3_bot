import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ChannelGateway from "./channelGateway.ts";
import {
  CommsChannelNotFoundError,
  CommsMemberNotFoundError,
  CommsPostFailedError,
  CommsPostNotFoundError,
  CommsReadFailedError,
  CommsToolkit,
  type PostResult,
  type ReadChannelResult,
} from "./tools.ts";

const DEFAULT_READ_LIMIT = 50;
const MAX_READ_LIMIT = 200;

/** Agents write "#seniors" and "seniors" interchangeably; so do humans. */
export const normalizeChannelName = (name: string): string => name.trim().replace(/^#+/, "");

/** Same for "@boss1" and "boss1". */
export const normalizeHandle = (handle: string): string => handle.trim().replace(/^@+/, "");

/**
 * Mentions the agent asked for, resolved against the channel's membership,
 * with duplicates collapsed.
 *
 * Unknown handles are an error rather than a silent drop: a mention that does
 * not resolve is a message that never wakes anyone, and the agent would have
 * no way to tell that from a delivered one. It reports every bad handle at
 * once so a retry does not discover them one at a time.
 */
export function resolveMentions(
  requested: ReadonlyArray<string>,
  members: ReadonlyArray<ChannelGateway.ChannelMember>,
): { readonly handles: ReadonlyArray<string> } | { readonly unknown: ReadonlyArray<string> } {
  const byHandle = new Map(members.map((member) => [normalizeHandle(member.handle), member]));
  const handles: Array<string> = [];
  const unknown: Array<string> = [];
  for (const entry of requested) {
    const handle = normalizeHandle(entry);
    if (handle.length === 0) continue;
    const member = byHandle.get(handle);
    if (!member) {
      if (!unknown.includes(handle)) unknown.push(handle);
    } else if (!handles.includes(member.handle)) {
      handles.push(member.handle);
    }
  }
  return unknown.length > 0 ? { unknown } : { handles };
}

const make = Effect.gen(function* () {
  const channels = yield* ChannelGateway.ChannelGateway;

  const failure =
    (Failure: typeof CommsPostFailedError | typeof CommsReadFailedError) =>
    <E>(cause: Cause.Cause<E>): Effect.Effect<never, CommsPostFailedError | CommsReadFailedError> =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause as Cause.Cause<never>)
        : Effect.fail(new Failure({ cause }));

  /**
   * The channel named, proven to have the calling thread as a member. Every
   * tool starts here, so membership is enforced once, on the credential's
   * thread, and no tool can act on a channel the caller is not in.
   */
  const requireChannel = Effect.fn("CommsToolkit.requireChannel")(function* (
    name: string,
    Failure: typeof CommsPostFailedError | typeof CommsReadFailedError,
  ) {
    const scope = yield* McpInvocationContext.requireMcpCapability("comms");
    const normalized = normalizeChannelName(name);
    const channel = yield* channels
      .getChannelForMember(normalized, scope.threadId)
      .pipe(Effect.catchCause(failure(Failure)));
    if (Option.isNone(channel)) {
      return yield* new CommsChannelNotFoundError({ channel: normalized });
    }
    return { channel: channel.value, threadId: scope.threadId };
  });

  const publish = Effect.fn("CommsToolkit.publish")(function* (input: {
    readonly channel: string;
    readonly body: string;
    readonly mentions: ReadonlyArray<string> | undefined;
    readonly parentPostId: string | null;
  }) {
    const { channel, threadId } = yield* requireChannel(input.channel, CommsPostFailedError);
    const resolved = resolveMentions(input.mentions ?? [], channel.members);
    if ("unknown" in resolved) {
      return yield* new CommsMemberNotFoundError({ handles: resolved.unknown });
    }
    const created = yield* channels
      .createPost({
        channelId: channel.channelId,
        authorThreadId: threadId,
        body: input.body,
        mentions: resolved.handles,
        parentPostId: input.parentPostId,
      })
      .pipe(Effect.catchCause(failure(CommsPostFailedError)));
    return {
      postId: created.postId,
      channel: channel.name,
      createdAt: created.createdAt,
      mentioned: resolved.handles,
    } satisfies PostResult;
  });

  return CommsToolkit.of({
    post: (input) =>
      publish({
        channel: input.channel,
        body: input.body,
        mentions: input.mentions,
        parentPostId: null,
      }),

    reply: (input) =>
      Effect.gen(function* () {
        // Checked before the post so a bad parentPostId fails instead of
        // silently landing an unthreaded message the agent believes is a reply.
        const { channel } = yield* requireChannel(input.channel, CommsPostFailedError);
        const page = yield* channels
          .readPosts({ channelId: channel.channelId, limit: MAX_READ_LIMIT, cursor: undefined })
          .pipe(Effect.catchCause(failure(CommsPostFailedError)));
        if (!page.posts.some((post) => post.postId === input.parentPostId)) {
          return yield* new CommsPostNotFoundError({ postId: input.parentPostId });
        }
        return yield* publish({
          channel: input.channel,
          body: input.body,
          mentions: input.mentions,
          parentPostId: input.parentPostId,
        });
      }),

    read_channel: (input) =>
      Effect.gen(function* () {
        const { channel } = yield* requireChannel(input.channel, CommsReadFailedError);
        const page = yield* channels
          .readPosts({
            channelId: channel.channelId,
            limit: Math.min(input.limit ?? DEFAULT_READ_LIMIT, MAX_READ_LIMIT),
            cursor: input.cursor,
          })
          .pipe(Effect.catchCause(failure(CommsReadFailedError)));
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
