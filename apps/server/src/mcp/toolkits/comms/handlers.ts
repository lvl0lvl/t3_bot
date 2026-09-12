import type { ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ChannelGateway from "./channelGateway.ts";
import {
  CommsChannelNotFoundError,
  CommsEmptyBodyError,
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
 * Trim, strip leading sigils, trim again, and repeat until nothing more comes
 * off. One pass is not enough: a sigil can hide behind whitespace that a
 * previous strip exposed, so `"# #seniors"` loses one `#`, then the space, and
 * would keep the second `#` forever.
 *
 * Shared by both canonicalizers because the stripping rule is genuinely the
 * same; whether the result is then case-folded is not, and that difference
 * stays at each caller where a reader can see it.
 */
const stripLeadingSigils = (value: string, sigil: RegExp): string => {
  let current = value.trim();
  for (;;) {
    const next = current.replace(sigil, "").trim();
    if (next === current) return current;
    current = next;
  }
};

/**
 * Trim, strip leading "#" to fixpoint, lowercase. A name of only sigils and
 * whitespace canonicalizes to empty and must be rejected rather than looked up.
 *
 * The lowercasing is not the toolkit's rule to make: the decider canonicalizes
 * on the way in, so the projection only ever holds lowercase and an exact
 * lookup cannot match anything else.
 */
export const canonicalChannelName = (name: string): string =>
  stripLeadingSigils(name, /^#+/).toLowerCase();

/**
 * The same stripping rule as a channel name, WITHOUT the case fold — and that
 * omission is deliberate rather than an oversight.
 *
 * The aggregate keys handles byte-exactly: `ChannelMemberHandle` is a branded
 * `TrimmedNonEmptyString` with no case rule, `canonicalChannelName` is applied
 * only to a channel's name, `requireChannelMentionsResolve` tests membership
 * with an exact Set, and `projection_channel_members` is keyed
 * `(channel_id, handle)` with no collation. So a member stored as "Boss1" is
 * mentioned as "Boss1"; emitting "boss1" gets the whole post rejected as an
 * unresolvable mention.
 *
 * Canonical handles are the intended end state (t3_bot-iin), and they have to
 * land in the aggregate first. Do not fold here until they have.
 */
const canonicalHandle = (handle: string): string => stripLeadingSigils(handle, /^@+/);

/**
 * Mentions the agent asked for, resolved against the channel's membership, with
 * duplicates collapsed.
 *
 * Unknown handles are an error rather than a silent drop: a mention that does
 * not resolve is a message that never wakes anyone, and the agent would have no
 * way to tell that from a delivered one. It reports every bad handle at once so
 * a retry does not discover them one at a time.
 *
 * Matching is forgiving, EMISSION IS NOT. Both sides of the lookup are
 * normalized so an agent can write "@Boss1", "boss1" or "  @boss1  " and reach
 * the same member — but what goes out is the member's own stored handle, byte
 * for byte, because the aggregate resolves a mention against its membership
 * with an exact comparison. Emitting the normalized key instead makes a member
 * stored as "@@PM" unmentionable: every spelling an agent would type collapses
 * to "PM", and "PM" resolves to nobody, so the whole post is rejected.
 *
 * That is the same defect as folding case, one axis over, and emitting the
 * stored handle closes both at once — it is correct for whatever the aggregate
 * holds rather than correct only while the toolkit and the aggregate agree.
 *
 * AN EXACT MATCH WINS. Members can share a canonical key — "boss1" and
 * "@boss1" both key on "boss1" — and the forgiving map keeps whichever came
 * last, so an agent naming one member byte-for-byte could wake the other and
 * be told it succeeded. Trying the raw handle first removes that: the only
 * cases left to insertion order are the ones where the agent's spelling
 * genuinely matches neither member exactly, where there is nothing to choose
 * between them.
 */
export function resolveMentions(
  requested: ReadonlyArray<string>,
  members: ReadonlyArray<ChannelGateway.ChannelMember>,
): { readonly handles: ReadonlyArray<string> } | { readonly unknown: ReadonlyArray<string> } {
  const byExactHandle = new Map(members.map((member) => [member.handle, member] as const));
  const byHandle = new Map(
    members.map((member) => [canonicalHandle(member.handle), member] as const),
  );
  const handles: Array<string> = [];
  const unknown: Array<string> = [];
  const seenHandles = new Set<string>();
  const seenUnknown = new Set<string>();
  for (const entry of requested) {
    const handle = canonicalHandle(entry);
    const member = byExactHandle.get(entry.trim()) ?? byHandle.get(handle);
    // Keyed on the member rather than on the spelling: two members CAN be named
    // in one post now that an exact match wins, and keying on the canonical
    // form would silently drop the second of them.
    if (member !== undefined) {
      if (!seenHandles.has(member.handle)) {
        seenHandles.add(member.handle);
        handles.push(member.handle);
      }
    } else if (handle.length === 0) {
      // Noise an agent's formatting produced — "@" on its own, a stray space.
      // Deliberately ignored rather than failing the post, and reachable only
      // when no member is spelled that way, since an exact match is tried
      // first and wins.
      continue;
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
    const normalized = canonicalChannelName(name);
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
    // The schema's non-empty check runs on the raw string, so a body of only
    // whitespace reaches here and would be written as "".
    const body = input.body.trim();
    if (body.length === 0) {
      return yield* new CommsEmptyBodyError();
    }
    const resolved = resolveMentions(input.mentions ?? [], input.channel.members);
    if ("unknown" in resolved) {
      return yield* new CommsMemberNotFoundError({ handles: resolved.unknown });
    }
    const created = yield* channels
      .createPost({
        channelId: input.channel.channelId,
        authorRef: { memberKind: "thread", memberId: input.threadId },
        body,
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
          // The members' own stored handles, byte for byte. The aggregate
          // matches a mention against its membership exactly, so any tidying
          // here — folding case, stripping a sigil — hands the agent a string
          // guaranteed to resolve to nobody, and the post it is used in is
          // rejected whole.
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
