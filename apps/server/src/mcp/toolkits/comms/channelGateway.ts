/**
 * The seam between the comms toolkit and the channel aggregate.
 *
 * `ChannelGatewayLive` implements it over the orchestration engine. The seam
 * stays because the toolkit's tests drive a fake through it, and because the
 * errors below are the vocabulary the toolkit translates for an agent — a
 * caller above this file cannot tell the two implementations apart.
 *
 * Ids are `string` here, and that is a staged simplification rather than a
 * contained one: branding them surfaces `ChannelMemberHandle` in `handlers.ts`
 * (mention resolution) and in `tools.ts` (the handles an agent sends and
 * receives), so it is a change to those files too.
 *
 * IDS ARE IDENTIFIERS, NOT TEXT, and `string` here understates them.
 * `ChannelId` and `ChannelPostId` are branded through `makeOpaqueEntityId`
 * (`packages/contracts/src/baseSchemas.ts`), which refuses anything outside
 * `^[A-Za-z0-9_-]{1,64}$` — no space, no colon, no line break, no emoji.
 *
 * On the BRAND rather than in a decider guard, which is the part worth knowing:
 * the refusal holds wherever the type is constructed, so a malformed id cannot
 * enter through a command NOR come back out of a persisted event. A consumer
 * that interpolates an id into a framed or delimited string is therefore
 * defended twice, and `MentionWakeReactor` still escapes its own — a charset
 * is a decision someone can relax later without revisiting every renderer that
 * inherited its safety from it.
 *
 * @module channelGateway
 */
import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** The store backing the channel projection could not answer. */
export class ChannelStoreUnavailable extends Schema.TaggedError<ChannelStoreUnavailable>()(
  "ChannelStoreUnavailable",
  { detail: Schema.String },
) {}

/**
 * The append did not land. `retryable` says whether trying the same post again
 * could ever work — and it is a property of the REFUSAL, not of this tag.
 *
 * An infrastructure failure is worth retrying; the aggregate REFUSING the post
 * is not, for the same input. Telling an agent to "try again" on a membership
 * that was revoked or a mention that no longer resolves is an instruction to
 * loop, and the agent has no other information to act on.
 */
export class ChannelWriteConflict extends Schema.TaggedError<ChannelWriteConflict>()(
  "ChannelWriteConflict",
  { detail: Schema.String, retryable: Schema.Boolean },
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

/**
 * The cursor was not issued by this channel.
 *
 * A TYPED REFUSAL rather than an empty page, and that is the whole point. The
 * cursor used to be the bare global event sequence, so one earned in another
 * channel matched no row here and the read came back empty with
 * `nextCursor: null` - which is byte for byte what "you are caught up" looks
 * like on the wire. The caller cannot tell those apart and stops reading
 * (`t3_bot-e60`).
 *
 * Carries what the caller SENT, not what was expected: the expected value is
 * this channel's own state and echoing it tells a prober something.
 */
export class ChannelCursorUnusable extends Schema.TaggedError<ChannelCursorUnusable>()(
  "ChannelCursorUnusable",
  { cursor: Schema.String, channelId: Schema.String },
) {}

/**
 * The channel is archived: readable, not postable.
 *
 * Distinct from "not found" on purpose. The caller is a member — they resolved
 * the channel to get here — so the conflation that hides a channel's existence
 * from outsiders has nothing to protect, and an error that said "no such
 * channel" would be false to the one reader who can already see it.
 */
export class ChannelArchived extends Schema.TaggedError<ChannelArchived>()("ChannelArchived", {}) {}

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
   * (`@t3tools/shared/channelIdentity`): variation selectors stripped,
   * whitespace collapsed and trimmed, leading sigils stripped to a fixpoint,
   * lowercased, NFC last. That is the order the function applies them in. The
   * aggregate applies the rule on every path that stores or compares a handle,
   * so this is the only form the projection holds.
   *
   * MATCHING IS FORGIVING, DELIVERY IS NOT, and that is the half a reader has
   * to take from this docstring. A caller may fold, strip and normalise to FIND
   * a member — the toolkit does. What it EMITS must be these bytes, because the
   * aggregate resolves a mention with an exact comparison, and this is a read
   * model: it outlives the version of the rule that wrote into it, so it can
   * hold a row that canonicalises to something other than itself. Emit the key
   * rather than the stored value and such a member becomes unmentionable, with
   * the whole post refused for it.
   *
   * That is not hypothetical. It shipped once, as a DISAGREEMENT rather than a
   * legacy row: the toolkit folded case while the aggregate compared bytes, a
   * member stored `Boss1` was echoed as `boss1`, and every post naming it was
   * rejected whole — with an error telling the agent to consult the tool that
   * had produced the wrong handle. The aggregate folds case itself now, so
   * that exact row cannot recur; the rule survives it, because the next change
   * to the canonicaliser writes the same shape of row again.
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
  /**
   * When the channel was retired, or `null`.
   *
   * ARCHIVED CHANNELS RESOLVE. A member can still read one; nobody can post to
   * one. The decider orders `requireChannelNotArchived` AFTER the membership
   * check so a NON-member cannot learn the channel exists — and a member
   * already knows it does, so telling them it is archived reveals nothing that
   * ordering protects. Telling them "no such channel" instead would hand an
   * agent that read it five minutes ago an answer identical to never having
   * been in it, and point it at a tool that would say nothing either.
   */
  readonly archivedAt: string | null;
}

export interface ChannelPostRecord {
  readonly postId: string;
  readonly authorHandle: string;
  readonly body: string;
  readonly mentions: ReadonlyArray<string>;
  readonly parentPostId: string | null;
  readonly createdAt: string;
}

/**
 * WHO IS ASKING. Derived from the caller's own credential, NEVER from a request
 * field.
 *
 * That rule is the whole of the read side's authorisation and nothing enforces
 * it mechanically. On the write side the decider refuses a channel command that
 * arrives without an issuer, so a gateway that forgot one would fail loudly;
 * here a caller that took this from its request payload would simply read
 * whatever that member can read, successfully, forever. A read tool that passed
 * an agent-supplied ref would let any agent read any channel any member is in.
 *
 * The toolkit passes `{ memberKind: "thread", memberId: <the credential's
 * thread> }`. An RPC passes the authenticated session's member. Neither reads
 * it off the wire.
 *
 * THERE IS ONE DOOR TODAY AND THERE WILL BE TWO. That is the condition, not the
 * safeguard: `ClientOrchestrationCommand` had two doors into one union and an
 * issuer stamped at one of them, which shipped, because the sweep that proved
 * the stamp was pointed only at the door its author was standing in. Each
 * caller here builds this value inline, so the second one can build it
 * differently — a human read as `"thread"`, or a memberId taken from the
 * payload rather than the session — and nothing in a type would say so.
 *
 * A caller adding itself: assert the KIND you pass, not only the id. The
 * toolkit's lookup tests do, which is what makes "derived from the credential"
 * checkable rather than a sentence in a docstring.
 *
 * CONSTRUCTED ONLY BY THE TWO FUNCTIONS BELOW. Not exported as a shape to build
 * inline, because a docstring is not a guard and this one has nothing behind it.
 *
 * DO NOT COLLAPSE THEM INTO `makeChannelMemberRef(kind, id)`. That is the
 * obvious simplification and it prevents nothing: it accepts the same two
 * fields from anywhere, so a handler passing `payload.memberId` through it is
 * indistinguishable from one passing the session's. The names below are load
 * bearing precisely because they are named for the SOURCE — taking the id from
 * a REQUEST is then not expressible without visibly going around the function,
 * and going around it is a thing a reviewer sees in a diff.
 *
 * The property is not "validate the ref". Nothing here validates anything. It
 * is: make the WRONG thing conspicuous, rather than merely making the right
 * thing available.
 */
export interface ChannelMemberRef {
  readonly memberKind: "thread" | "human";
  readonly memberId: string;
}

/**
 * The member an MCP tool call is acting as: the credential's own thread.
 *
 * Takes the invocation scope rather than a thread id, so there is no signature
 * a request field fits. The agent's arguments are not in scope here and cannot
 * be.
 */
export const refFromMcpCredential = (scope: { readonly threadId: string }): ChannelMemberRef => ({
  memberKind: "thread",
  memberId: scope.threadId,
});

/**
 * The member a browser request is acting as: the operator, from the session.
 *
 * NAMED FOR THE SOURCE, which is the whole of its value. `fromHuman(id)` would
 * accept a memberId out of a request payload and look correct doing it; this
 * one is wrong-looking at the call site the moment the argument is not a
 * session. For M1 the operator is a single seeded identity, so the session
 * carries no member of its own yet and this returns the constant — when it
 * does, this is the one line that changes and every caller inherits it.
 */
export const refFromOperatorSession = (session: {
  readonly operatorMemberId: string;
}): ChannelMemberRef => ({
  memberKind: "human",
  memberId: session.operatorMemberId,
});

export type ReadDirection = "forward" | "backward";

export interface ChannelPage {
  /**
   * ALWAYS ascending by sequence, whatever the direction.
   *
   * `direction` chooses the WINDOW and which way `nextCursor` points; it never
   * chooses the order. Every caller renders oldest-at-top, so returning a
   * backward page newest-first would put a `.reverse()` in each of them — a
   * step that is correct until someone forgets it, and a page nobody reversed
   * reads as though time runs backwards, which gets diagnosed as a data bug.
   */
  readonly posts: ReadonlyArray<ChannelPostRecord>;
  /**
   * Opaque. Hand it back verbatim; never construct or parse one.
   *
   * Null means there is nothing further IN THAT DIRECTION — the newest post
   * going forward, the beginning of history going backward.
   */
  readonly nextCursor: string | null;
}

export interface CreatePostInput {
  readonly channelId: string;
  /**
   * The calling thread, from its MCP credential and never from tool input.
   *
   * THE LIVE LAYER PASSES THIS AS AN ISSUER, NOT AS A COMMAND FIELD:
   *
   *   engine.dispatch(command, { issuer: { memberKind: "thread", memberId: threadId } })
   *
   * `channel.post.create` has no author field at all. It used to, and a command
   * carrying its own author is what made authorship forgeable — the decider
   * derives the author from an engine-stamped issuer now, and refuses a channel
   * command that arrives without one. So a gateway wired from the old
   * instruction dispatches with no issuer and every agent post is refused with
   * "arrived without an issuer and cannot be authorized": a correct-looking
   * implementation that declines everything.
   *
   * `authorHandle` is resolved by the decider from the channel's membership,
   * which is why nothing here carries it either.
   */
  readonly threadId: ThreadId;
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
  /**
   * A `nextCursor` from an earlier read of THIS channel, handed back verbatim.
   *
   * Omitted for the first page, which depends on the direction: "forward"
   * starts at the oldest post, "backward" at the newest.
   *
   * A CURSOR FROM ANOTHER CHANNEL IS REFUSED, not answered. It used to be the
   * bare event sequence, which is global — so one earned in another channel was
   * well-formed digits matching no row here, and the read came back as an empty
   * page with `nextCursor: null`: byte for byte the answer for "you are caught
   * up". Three unread posts behind a successful reply, undetectable by the
   * caller, on the feature whose whole purpose is catching up (`t3_bot-e60`).
   */
  readonly cursor: string | undefined;
  /**
   * "forward" is oldest-first from the cursor — an agent tailing a channel.
   * "backward" is the newest page and then upward — a UI opening one.
   */
  readonly direction: ReadDirection;
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
    member: ChannelMemberRef,
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
  ) => Effect.Effect<ChannelPage, ChannelStoreUnavailable | ChannelCursorUnusable>;

  /**
   * Appends a post. Rejects a post whose author is not a current member of
   * `channelId`, and rejects a post carrying a mention that does not resolve to
   * one — a post that silently drops a mention wakes nobody while looking sent.
   *
   * THREE OF THE FIVE FAILURES BELOW HAVE NO LIVE PRODUCER, and a caller should
   * not write handling for them yet. `ChannelGatewayLive` returns
   * `ChannelStoreUnavailable` or `ChannelWriteConflict` and nothing else: the
   * decider's refusals all arrive as one invariant error distinguished only by
   * its prose, and matching on that prose is both fragile and the thing that
   * leaked an internal channelId to an agent. `ChannelMembershipRevoked`,
   * `ChannelMentionUnresolvable` and `ChannelArchived` are constructed by test
   * fakes only.
   *
   * They stay declared because the distinctions are the right ones and a caller
   * will want them; `t3_bot-dnz` is giving the decider a machine-readable reason
   * so the live layer can classify without reading English.
   *
   * ARCHIVED IS THE CALLER'S, not this seam's, until then: decide it from the
   * `archivedAt` on the channel you already resolved membership on. Re-reading
   * the row here would answer an existence question without a membership check,
   * and "archived" tells a reader the channel EXISTS — which a non-member must
   * not learn.
   */
  readonly createPost: (
    input: CreatePostInput,
  ) => Effect.Effect<
    CreatedPost,
    | ChannelStoreUnavailable
    | ChannelWriteConflict
    | ChannelMembershipRevoked
    | ChannelMentionUnresolvable
    | ChannelArchived
  >;
}

export class ChannelGateway extends Context.Service<ChannelGateway, ChannelGatewayShape>()(
  "t3/mcp/toolkits/comms/channelGateway",
) {}
