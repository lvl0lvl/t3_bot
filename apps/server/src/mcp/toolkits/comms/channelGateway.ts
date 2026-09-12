/**
 * The seam between the comms toolkit and the channel aggregate.
 *
 * The aggregate exists — `channel.*` commands, the channel projection and the
 * branded id types are all on `main`. What is still missing is the LAYER:
 * `ChannelGatewayUnavailable` is what is wired, so every operation dies, and
 * `t3_bot-0uq` is the change that supplies a live one. Swapping it in changes
 * nothing above this file.
 *
 * Ids are `string` here, and that is a staged simplification rather than a
 * contained one: branding them surfaces `ChannelMemberHandle` in `handlers.ts`
 * (mention resolution) and in `tools.ts` (the handles an agent sends and
 * receives), so it is a change to those files too. `ChannelId` and
 * `ChannelPostId` are now `^[A-Za-z0-9_-]{1,64}$` at the aggregate
 * (`t3_bot-2d2`), which a `string` here does not say — a caller reading this
 * file would not know an id cannot carry a space.
 *
 * @module channelGateway
 */
import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** The store backing the channel projection could not answer. */
export class ChannelStoreUnavailable extends Schema.TaggedError<ChannelStoreUnavailable>()(
  "ChannelStoreUnavailable",
  { detail: Schema.String },
) {}

/** The append lost a race and the caller may retry. */
export class ChannelWriteConflict extends Schema.TaggedError<ChannelWriteConflict>()(
  "ChannelWriteConflict",
  { detail: Schema.String },
) {}

/**
 * The author is not a member of the channel at write time.
 *
 * The toolkit checks membership before calling, but that check and this write
 * are not atomic, so the aggregate re-checks and this is the enforcement point
 * every future caller inherits.
 */
export class ChannelMembershipRevoked extends Schema.TaggedError<ChannelMembershipRevoked>()(
  "ChannelMembershipRevoked",
  {},
) {}

/** A mention did not resolve to a current member; the post is rejected whole. */
export class ChannelMentionUnresolvable extends Schema.TaggedError<ChannelMentionUnresolvable>()(
  "ChannelMentionUnresolvable",
  { handles: Schema.Array(Schema.String) },
) {}

/**
 * A channel member. `memberId` of a thread member is its `ThreadId`, but the
 * field is never named `threadId`: a `threadId` at the top level of a
 * `channel.*` payload routes the command to the wrong aggregate, silently.
 */
export interface ChannelMember {
  /**
   * What the agent types to mention this member, without the leading "@".
   *
   * CANONICAL, by the shared rule with "@" as the sigil
   * (`@t3tools/shared/channelIdentity`): whitespace collapsed, variation
   * selectors stripped, leading sigils stripped to a fixpoint, lowercased, NFC
   * last. The aggregate applies it on every path that stores or compares a
   * handle, so this is the only form the projection holds.
   *
   * MATCHING IS FORGIVING, DELIVERY IS NOT, and that is the half a reader has
   * to take from this docstring. A caller may fold, strip and normalise to FIND
   * a member — the toolkit does. What it EMITS must be these bytes, because the
   * aggregate resolves a mention with an exact comparison, and this is a read
   * model: it can hold a row written under an older form of the rule, which
   * canonicalises to something other than itself. Emit the key rather than the
   * stored value and such a member becomes unmentionable, with the whole post
   * refused for it.
   *
   * That is not hypothetical. It shipped once: the toolkit folded case while
   * the aggregate compared bytes, a member stored `Boss1` was echoed as
   * `boss1`, and every post naming it was rejected whole — with an error
   * telling the agent to consult the tool that had produced the wrong handle.
   */
  readonly handle: string;
  readonly memberKind: "thread" | "human";
  readonly memberId: string;
}

export interface Channel {
  readonly channelId: string;
  /**
   * Canonical name, by the shared rule with "#" as the sigil.
   *
   * The OPERATION rather than the property, because the property was once
   * stated for an implementation that did not produce it: a single-pass strip
   * leaves the second "#" of "# #seniors" in place forever. The strip runs to a
   * fixpoint now, so "no leading sigil" does hold — verified, not assumed — but
   * it holds BECAUSE of the operation, and a future single-pass rewrite would
   * falsify the property while looking like it satisfied it.
   *
   * The decider canonicalises on the way in, so this is the only form the
   * projection holds and the only form a lookup can match.
   */
  readonly name: string;
  readonly members: ReadonlyArray<ChannelMember>;
}

export interface ChannelPostRecord {
  readonly postId: string;
  readonly authorHandle: string;
  readonly body: string;
  readonly mentions: ReadonlyArray<string>;
  readonly parentPostId: string | null;
  readonly createdAt: string;
}

export interface ChannelPage {
  readonly posts: ReadonlyArray<ChannelPostRecord>;
  readonly nextCursor: string | null;
}

/** Identifies the author. Never a value the agent supplies. */
export interface ChannelAuthorRef {
  readonly memberKind: "thread" | "human";
  readonly memberId: string;
}

export interface CreatePostInput {
  readonly channelId: string;
  /**
   * Derived from the calling thread's credential, never from tool input. The
   * live layer translates this to the `authorRef` its command carries and
   * resolves `authorHandle` from the channel's membership.
   */
  readonly authorRef: ChannelAuthorRef;
  readonly body: string;
  /** Handles, already resolved against the channel's membership. */
  readonly mentions: ReadonlyArray<string>;
  readonly parentPostId: string | null;
}

export interface CreatedPost {
  readonly postId: string;
  readonly createdAt: string;
}

export interface ReadPostsInput {
  readonly channelId: string;
  /** 1..200, enforced at the tool schema; the gateway may assume the range. */
  readonly limit: number;
  /** Omitted for the first page. */
  readonly cursor: string | undefined;
}

export interface ChannelGatewayShape {
  /**
   * The channel by name, but only if `threadId` is a member of it. A
   * non-member and a non-existent channel are the same answer: an agent must
   * not be able to probe for channels it is not in.
   *
   * `name` must already be canonical by `canonicalChannelName`. Matching is
   * exact, so a caller passing what the agent typed rather than the canonical
   * form gets `None` — indistinguishable, by the rule above, from being
   * excluded, which is why the live layer treats a non-canonical name as a
   * DEFECT and dies rather than returning that silence.
   */
  readonly getChannelForMember: (
    name: string,
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<Channel>, ChannelStoreUnavailable>;

  /**
   * One post by id, scoped to `channelId`. `None` when the post does not exist
   * or belongs to another channel — the two are indistinguishable for the same
   * reason `getChannelForMember` conflates its two cases.
   *
   * This exists so `reply` can ask whether a parent exists without paging
   * history to find out: a lookback bounded by a page size silently refuses
   * replies to anything outside it.
   */
  readonly getPost: (
    channelId: string,
    postId: string,
  ) => Effect.Effect<Option.Option<ChannelPostRecord>, ChannelStoreUnavailable>;

  /**
   * One page of posts, oldest first, ascending by sequence.
   *
   * `cursor` is opaque and points AFTER the last post returned, so passing a
   * page's `nextCursor` yields the posts newer than it. `nextCursor` is `null`
   * when no newer posts exist. `limit` is a maximum, not an exact count.
   */
  readonly readPosts: (
    input: ReadPostsInput,
  ) => Effect.Effect<ChannelPage, ChannelStoreUnavailable>;

  /**
   * Appends a post. Rejects a post whose author is not a current member of
   * `channelId`, and rejects a post carrying a mention that does not resolve to
   * one — a post that silently drops a mention wakes nobody while looking sent.
   */
  readonly createPost: (
    input: CreatePostInput,
  ) => Effect.Effect<
    CreatedPost,
    | ChannelStoreUnavailable
    | ChannelWriteConflict
    | ChannelMembershipRevoked
    | ChannelMentionUnresolvable
  >;
}

export class ChannelGateway extends Context.Service<ChannelGateway, ChannelGatewayShape>()(
  "t3/mcp/toolkits/comms/channelGateway",
) {}

/**
 * Defect rather than a typed failure: reaching this means the live layer was
 * not wired, which is a build mistake, not a condition an agent can cause or an
 * operator can fix by retrying. Keeping it out of the typed error channel also
 * keeps "not implemented" from masquerading as "store unavailable".
 */
const notWired = (operation: string) =>
  Effect.die(new Error(`ChannelGateway.${operation} called before the channel aggregate landed.`));

/** Stands in until the channel aggregate lands. */
export const ChannelGatewayUnavailable = Layer.succeed(
  ChannelGateway,
  ChannelGateway.of({
    getChannelForMember: () => notWired("getChannelForMember"),
    getPost: () => notWired("getPost"),
    readPosts: () => notWired("readPosts"),
    createPost: () => notWired("createPost"),
  }),
);
