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
import { refFromThreadCredential } from "@t3tools/contracts";
import type {
  ChannelId,
  ChannelMemberRef,
  OrchestrationChannelPostWakeOutcome,
  ThreadId,
} from "@t3tools/contracts";
import type * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// THE REFUSAL VOCABULARY COMES FROM THE CODEC, which is the only thing that can
// tell the three causes apart, and is re-exported here because this file is where
// the toolkit reads the gateway's error vocabulary. Spelling the three words again
// would be the second spelling of one rule this repo has been burned by four times.
import { ChannelCursorRefusal } from "../../../orchestration/channelCursor.ts";

export { ChannelCursorRefusal };

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
 * The cursor cannot be used for this read, and `reason` says which of the three.
 *
 * A TYPED REFUSAL rather than an empty page, and that is the whole point. The
 * cursor used to be the bare global event sequence, so one earned in another
 * channel matched no row here and the read came back empty with
 * `nextCursor: null` - which is byte for byte what "you are caught up" looks
 * like on the wire. The caller cannot tell those apart and stops reading
 * (`t3_bot-e60`).
 *
 * THREE CAUSES, NAMED. The channel did not issue it, the other DIRECTION of this
 * channel issued it, or it is not the shape a cursor has. One error with one
 * sentence for all three told an agent its cursor came from another channel when
 * this channel had issued it (`t3_bot-2oh`); the recovery is the same in every
 * case, which is exactly why the false clause survived.
 *
 * Carries what the caller SENT, not what was expected: the expected value is
 * this channel's own state and echoing it tells a prober something. `reason` is
 * safe by the same test - it names which of this caller's own inputs was wrong.
 */
export class ChannelCursorUnusable extends Schema.TaggedError<ChannelCursorUnusable>()(
  "ChannelCursorUnusable",
  { cursor: Schema.String, channelId: Schema.String, reason: ChannelCursorRefusal },
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
  /**
   * THE BRAND, NOT A STRING, on every id this seam takes or hands out. A
   * `.make` on a caller-supplied string throws while the call is being
   * assembled - before any Effect exists, so no `catchTags`/`catchCause`
   * around the call ever runs (`t3_bot-d7d`; the first instance was #13's
   * `comms_reply` dying on "a:b"). The projection row is already decoded
   * into the brand, so the live layer has nothing to construct; a caller that
   * holds a raw string - the next one holds values from a browser - decodes
   * at its own door with `Schema.decode` and gets a typed refusal there.
   */
  readonly channelId: ChannelId;
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

/**
 * One thread a post woke, and how that wake's turn ended.
 *
 * Strings, like every id on this seam. The vocabulary is the contract's
 * (`OrchestrationChannelPostWakeOutcome`) and is NOT re-declared here as a
 * union: the seam would then be a second spelling of the five words, and the
 * handler that copies them across would compile against either.
 */
export interface ChannelPostWakeRecord {
  readonly threadId: string;
  readonly turnId: string;
  readonly outcome: OrchestrationChannelPostWakeOutcome;
}

export interface ChannelPostRecord {
  readonly postId: string;
  readonly authorHandle: string;
  readonly body: string;
  readonly mentions: ReadonlyArray<string>;
  readonly parentPostId: string | null;
  readonly createdAt: string;
  /**
   * The threads this post woke and how each wake ended; ABSENT when it woke
   * nobody, never an empty array. One element per thread, because a post
   * mentioning two handles wakes two, and the two turns can end differently
   * (`t3_bot-j6o`).
   */
  readonly wakes?: ReadonlyArray<ChannelPostWakeRecord>;
}

/**
 * WHO IS ASKING, re-exported from `@t3tools/contracts` rather than declared here.
 *
 * IT MOVED BECAUSE IT HAD GROWN A SECOND SPELLING. This module owned a nominal
 * class while `ProjectionChannels.ts` declared a structural interface of the
 * same name, and `ws.ts` could only reach the structural one — so the
 * unconstructible type guarded the toolkit and nothing guarded the websocket.
 * One home, one type; the persistence repository now takes the nominal one.
 *
 * Why a private field rather than a `unique symbol` brand, and why there is no
 * `makeChannelMemberRef(kind, id)`: see
 * `packages/contracts/src/channelMemberRef.ts`. Both arguments live with the
 * type now instead of beside one of its consumers.
 */
export type { ChannelMemberRef } from "@t3tools/contracts";

/**
 * The member an MCP tool call acts as: the credential's own thread.
 *
 * TAKES THE INVOCATION SCOPE, not a thread id, so there is no parameter an
 * agent-supplied value fits. The tool's arguments are not in scope here and
 * cannot be passed by mistake. `refFromThreadCredential` in contracts takes a
 * branded `ThreadId` and is the general form; this is the one handlers import,
 * because a scope is a credential and an id is merely a string that typechecks.
 *
 * WHY IT MATTERS MORE HERE THAN ON THE WRITE SIDE: the decider refuses a channel
 * command that arrives without an issuer, so a gateway that forgot one fails
 * loudly. Nothing refuses a wrong ref on the read side. A read handler that
 * passed an agent-supplied member would return the right answer for the wrong
 * member, successfully, forever.
 */
export const refFromMcpCredential = (
  scope: McpInvocationContext.McpInvocationScope,
): ChannelMemberRef => refFromThreadCredential(scope.threadId);

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
   *
   * IT RECORDS THE DIRECTION THAT ISSUED IT, and a cursor used in the other
   * one is REFUSED (`t3_bot-2oh`). It did not, and that was the same lie the
   * channel half was introduced to end, one axis over — a forward cursor read
   * backward answered with the oldest page and `nextCursor: null`, byte for
   * byte "you are caught up", while everything after it was unread. Measured on
   * the live gateway over six posts rather than reasoned about:
   *
   *   forward page1                     = [p1,p2]  cursor=<channel>:forward:6
   *   that forward cursor, read BACKWARD = [p1]      cursor=null
   *   backward page1                    = [p5,p6]  cursor=<channel>:backward:9
   *   that backward cursor, read FORWARD = [p6]      cursor=null
   *
   * Four unread posts behind the first `null` and four behind the second. It
   * was never reachable from production — the only caller hardcodes forward —
   * and it would have become reachable the day a second caller chose, which is
   * a UI opening a channel on its newest page.
   */
  readonly nextCursor: string | null;
}

export interface CreatePostInput {
  /** From `getChannelForMember`, or decoded at the caller's door; see `Channel.channelId`. */
  readonly channelId: ChannelId;
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
  /** From `getChannelForMember`, or decoded at the caller's door; see `Channel.channelId`. */
  readonly channelId: ChannelId;
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
   *
   * AND SO IS ONE FROM THE OTHER DIRECTION, for the same reason on the other
   * axis (`t3_bot-2oh`), and one whose shape is not a cursor at all — including
   * one issued before the direction segment existed. `ChannelCursorUnusable`
   * carries which of the three it was, because the toolkit turns that into a
   * sentence an agent acts on and one sentence for three causes was false for
   * two of them.
   */
  readonly cursor: string | undefined;
  /**
   * "forward" is oldest-first from the cursor — an agent tailing a channel.
   * "backward" is the newest page and then upward — a UI opening one.
   *
   * PART OF THE CURSOR'S IDENTITY, not just of this call. A cursor points AFTER
   * its page going forward and BEFORE it going backward, so the same number
   * means opposite things; `direction` is encoded into every `nextCursor` and
   * compared on the way back in. WHAT BREAKS: a caller that stores a cursor and
   * later reads with the other direction — a UI whose user flips the order, a
   * client resuming from a persisted cursor after its default changed — gets
   * `ChannelCursorUnusable` rather than a page. That is the point; before it,
   * the read answered with an early page and `nextCursor: null` over four
   * unread posts (`t3_bot-2oh`).
   */
  readonly direction: ReadDirection;
}

export interface ChannelGatewayShape {
  /**
   * The channel by name, but only if `member` belongs to it. A non-member and a
   * non-existent channel are the same answer: an agent must not be able to
   * probe for channels it is not in.
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
    channelId: ChannelId,
    postId: string,
  ) => Effect.Effect<Option.Option<ChannelPostRecord>, ChannelStoreUnavailable>;

  /**
   * One page of posts, ALWAYS ascending by sequence in both directions.
   *
   * `direction` chooses the WINDOW and which way the cursor points, never the
   * order the rows arrive in:
   *
   *   "forward"  - oldest first from the cursor; `nextCursor` points AFTER the
   *                last post returned, and is null when no NEWER post exists.
   *   "backward" - the newest page, then upward; `nextCursor` points BEFORE the
   *                first post returned, and is null at the START of history.
   *
   * `cursor` is opaque and belongs to THIS channel AND THIS DIRECTION. Three
   * things make one unusable - another channel issued it, the other direction
   * issued it, or it is not the shape a cursor has - and all three are refused
   * with `ChannelCursorUnusable`, whose `reason` says which, rather than
   * answered with an empty page. The empty page is indistinguishable from "you
   * are caught up", which is the defect this contract exists to prevent.
   * `limit` is a maximum, not an exact count.
   */
  readonly readPosts: (
    input: ReadPostsInput,
  ) => Effect.Effect<ChannelPage, ChannelStoreUnavailable | ChannelCursorUnusable>;

  /**
   * Appends a post. Rejects a post whose author is not a current member of
   * `channelId`, and rejects a post carrying a mention that does not resolve to
   * one — a post that silently drops a mention wakes nobody while looking sent.
   *
   * PRECONDITION: `channelId` was obtained from `getChannelForMember` for the
   * same member ref the caller issues as. A caller that passes any other id
   * makes revoked-vs-conflict an existence answer for whichever principal it
   * serves: an id that names a channel the author is not in is refused as
   * `ChannelMembershipRevoked`, and one that names no channel at all as
   * `ChannelWriteConflict`.
   *
   * POSTCONDITION: membership, mentions and archived are enforced at write
   * time regardless of any pre-check. A caller that pre-checks against the row
   * it resolved sees the three refusals only as races; a caller that does not
   * sees them as its first answer; both are correct. The decider checks
   * membership BEFORE archived, so a non-member never learns the channel
   * exists this way. `commsLive.integration.test` reaches each of the three
   * through the real decider by changing the channel between the toolkit's
   * check and the write.
   *
   * EVERY FAILURE BELOW HAS A LIVE PRODUCER. The live layer classifies from
   * the decider's `reason` tag, never from its prose: the prose names the
   * channel by its internal id, and forwarding it once handed that id to an
   * agent (`t3_bot-dnz`). A refusal the decider has not tagged arrives as
   * `ChannelWriteConflict` with `retryable: false`. `createPost` performs no
   * read of its own; a store failure during the write reaches the caller as
   * `ChannelWriteConflict { retryable: true }`.
   */
  readonly createPost: (
    input: CreatePostInput,
  ) => Effect.Effect<
    CreatedPost,
    ChannelWriteConflict | ChannelMembershipRevoked | ChannelMentionUnresolvable | ChannelArchived
  >;
}

export class ChannelGateway extends Context.Service<ChannelGateway, ChannelGatewayShape>()(
  "t3/mcp/toolkits/comms/channelGateway",
) {}
