import type { ThreadId } from "@t3tools/contracts";
import { canonicalChannelHandle, canonicalChannelName } from "@t3tools/shared/channelIdentity";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ChannelGateway from "./channelGateway.ts";
import {
  CommsChannelArchivedError,
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
 * The canonical form of a channel name and of a member handle, RE-EXPORTED
 * rather than reimplemented.
 *
 * There were two implementations of one rule and they diverged four times in a
 * single evening: how many leading sigils a name loses, whether a handle folds
 * case, NFC, then NFC's position relative to the fold. Every time, both sides'
 * tests stayed green, because a copy agrees with itself. The last divergence
 * came from nobody disagreeing - the decider's side was improved and this copy,
 * correct when it was written, silently became wrong.
 *
 * Re-exported rather than merely imported so that the toolkit's public surface
 * IS the shared function object. `canonicalOneImplementation.test.ts` asserts
 * that by reference, and reference is the assertion that fails for a second
 * implementation even when the second one is byte-for-byte correct today.
 */
export { canonicalChannelHandle, canonicalChannelName };

/**
 * Mentions the agent asked for, resolved against the channel's membership, with
 * duplicates collapsed.
 *
 * Unknown handles are an error rather than a silent drop: a mention that does
 * not resolve is a message that never wakes anyone, and the agent would have no
 * way to tell that from a delivered one. It reports every bad handle at once so
 * a retry does not discover them one at a time.
 *
 * Matching is forgiving, DELIVERY IS NOT. Both sides of the lookup are
 * normalized so an agent can write "@Boss1", "boss1" or "  @boss1  " and reach
 * the same member — but a RESOLVED handle goes out as the member's own stored
 * bytes, because the aggregate resolves a mention against its membership with
 * an exact comparison. Emitting the normalized key instead makes a member
 * stored as "@@PM" unmentionable: every spelling an agent would type collapses
 * to "PM", and "PM" resolves to nobody, so the whole post is rejected.
 *
 * An UNRESOLVED handle is different and deliberately so: it goes out in
 * canonical form, in the error. Nothing matches against it, and showing the
 * agent the form the lookup actually used is the only diagnostic that error
 * can carry. The rule is not "canonical output never leaves this function" —
 * it does — but that it never leaves as a value something else will compare.
 *
 * That is the same defect as folding case, one axis over, and emitting the
 * stored handle closes both at once — it is correct for whatever the aggregate
 * holds rather than correct only while the toolkit and the aggregate agree.
 * The aggregate now stores canonical handles, so the key and the stored bytes
 * usually coincide; that is a reason to keep emitting the stored bytes, not a
 * reason to stop, because it is exactly the coincidence that hid this bug.
 *
 * AN EXACT MATCH WINS, and the reason is narrower than it looks. It is NOT
 * what reaches a row stored in an older form: a lone member stored "Boss1" is
 * keyed "boss1" in the forgiving map and the canonical path reaches it with
 * identical output. Delete this precedence and every test over a single legacy
 * row still passes.
 *
 * What it buys is the COLLIDING roster - two members sharing one canonical key,
 * which only a pre-canonicalisation read model can hold, since
 * `requireChannelHandlesUnique` runs on canonical handles now. The forgiving
 * map keeps whichever came last, so without this an agent typing one member's
 * exact bytes wakes the OTHER one: a different memberId, on a call that returns
 * success. Trying the raw spelling first means the byte-exact spelling reaches
 * the member who owns it. Only that spelling - "@Boss1" and "BOSS1" still fall
 * to the forgiving map and are decided by insertion order, which is a real
 * remaining gap and not something this precedence closes.
 */
export function resolveMentions(
  requested: ReadonlyArray<string>,
  members: ReadonlyArray<ChannelGateway.ChannelMember>,
): { readonly handles: ReadonlyArray<string> } | { readonly unknown: ReadonlyArray<string> } {
  const byExactHandle = new Map(members.map((member) => [member.handle, member] as const));
  // Empty keys are kept out deliberately. A member whose handle canonicalizes
  // to nothing — "@" — would otherwise be reachable through this map by any
  // spelling that also canonicalizes to nothing, so a stray space or a bare
  // "@@" from the agent would wake a real member on a post addressed to
  // nobody. Such a member is still reachable by its exact handle above.
  //
  // `requireCanonicalChannelHandle` refuses a handle with no canonical form, so
  // the aggregate no longer stores one. Same reason as the exact-match rule
  // above: this map is built from a read model that can still hold rows the
  // aggregate would refuse today.
  const byHandle = new Map(
    members
      .map((member) => [canonicalChannelHandle(member.handle), member] as const)
      .filter(([key]) => key.length > 0),
  );
  const handles: Array<string> = [];
  const unknown: Array<string> = [];
  const seenHandles = new Set<string>();
  const seenUnknown = new Set<string>();
  for (const entry of requested) {
    const handle = canonicalChannelHandle(entry);
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

  // A FUNCTION of the channel, because one of these refusals has to name it.
  // An archived error carrying no channel is the shape an agent cannot act on:
  // it is in several, and the message would not say which one it may no longer
  // post to.
  const onCreateFailure = (channelName: string) =>
    ({
      ChannelStoreUnavailable: (error: ChannelGateway.ChannelStoreUnavailable) =>
        Effect.fail(new CommsPostFailedError({ detail: error.detail, retryable: false })),
      ChannelWriteConflict: (error: ChannelGateway.ChannelWriteConflict) =>
        // Carried through, not decided here. Whether a retry could work is
        // known where the failure happened; this layer would be guessing.
        Effect.fail(new CommsPostFailedError({ detail: error.detail, retryable: error.retryable })),
      ChannelMembershipRevoked: () => Effect.fail(new CommsMembershipLostError()),
      ChannelMentionUnresolvable: (error: ChannelGateway.ChannelMentionUnresolvable) =>
        Effect.fail(new CommsMemberNotFoundError({ handles: error.handles })),
      // Named, never folded into "not found". The caller resolved this channel to
      // get here, so it can see the channel exists; an error saying otherwise
      // would be false to the one reader who can check.
      ChannelArchived: () => Effect.fail(new CommsChannelArchivedError({ channel: channelName })),
    }) as const;

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
    // ARCHIVED IS DECIDED HERE, from the channel the caller already proved
    // membership on, rather than by the gateway re-reading the row.
    //
    // The decider runs `requireChannelNotArchived` AFTER
    // `requireChannelAuthorIsMember` on purpose: "archived" tells the reader
    // the channel EXISTS, which a non-member must not learn, so the two have to
    // stay one answer to an outsider. The gateway had no membership check of
    // its own, so that ordering was held only by this file calling
    // `requireChannel` first - a rule in another file, about a different
    // function, which is exactly the coupling the post id taught us not to
    // rely on. Here the membership proof and the archived check are the same
    // value.
    if (input.channel.archivedAt !== null) {
      return yield* new CommsChannelArchivedError({ channel: input.channel.name });
    }
    const resolved = resolveMentions(input.mentions ?? [], input.channel.members);
    if ("unknown" in resolved) {
      return yield* new CommsMemberNotFoundError({ handles: resolved.unknown });
    }
    const created = yield* channels
      .createPost({
        channelId: input.channel.channelId,
        threadId: input.threadId,
        body,
        mentions: resolved.handles,
        parentPostId: input.parentPostId,
      })
      .pipe(Effect.catchTags(onCreateFailure(input.channel.name)), Effect.catchCause(writeDefect));
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
          // The same value `publish` refuses on, read off the same channel, so
          // the two cannot drift into telling an agent it may post and then
          // refusing it.
          postable: channel.archivedAt === null,
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
