/**
 * The live ChannelGateway: the seam's shapes, answered from the channel
 * projection and the orchestration engine.
 *
 * Everything above this file is written against `channelGateway.ts` and does
 * not change when this layer is swapped for another. What is here
 * is translation and nothing else — no rule of its own, because a rule that
 * lives in an interface's implementation is a rule that exists once per
 * implementer, in the layer least able to notice when the copies drift.
 *
 * @module channelGatewayLive
 */
import { ChannelId, ChannelMemberHandle, ChannelPostId, CommandId } from "@t3tools/contracts";
import { canonicalChannelName } from "@t3tools/shared/channelIdentity";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { isOrchestrationCommandRejection } from "../../../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import {
  ProjectionChannelRepository,
  type ProjectionChannel,
  type ProjectionChannelPost,
} from "../../../persistence/Services/ProjectionChannels.ts";
import {
  ChannelGateway,
  ChannelStoreUnavailable,
  ChannelCursorUnusable,
  ChannelWriteConflict,
  type Channel,
  type ChannelMemberRef,
  type ChannelPage,
  type ChannelPostRecord,
  type CreatePostInput,
  type ReadPostsInput,
} from "./channelGateway.ts";

/**
 * A projection read that failed is the store not answering, which is what the
 * seam's one read error means.
 *
 * The detail names the OPERATION rather than carrying the cause's text,
 * because this string is read by an AGENT and the cause is written for an
 * operator: a SQL message tells an agent nothing it can act on and may carry a
 * path or an id from inside the server. The cause is dropped rather than
 * logged here - the caller decides what to do with the failure, and
 * `Effect.mapError` is not the place that knows.
 */
const storeUnavailable = (operation: string) =>
  new ChannelStoreUnavailable({ detail: `channel projection unavailable (${operation})` });

const toChannel = (row: ProjectionChannel): Channel => ({
  channelId: row.channelId,
  name: row.name,
  archivedAt: row.archivedAt,
  members: row.members.map((member) => ({
    handle: member.handle,
    memberKind: member.memberKind,
    memberId: member.memberId,
  })),
});

const toPost = (row: ProjectionChannelPost): ChannelPostRecord => ({
  postId: row.postId,
  authorHandle: row.authorHandle,
  body: row.body,
  mentions: [...row.mentions],
  parentPostId: row.parentPostId,
  createdAt: row.createdAt,
});

const make = Effect.gen(function* () {
  const channels = yield* ProjectionChannelRepository;
  const engine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;

  const getChannelForMember = (name: string, member: ChannelMemberRef) =>
    Effect.gen(function* () {
      // A NON-CANONICAL NAME IS A DEFECT, not a typed failure. Matching here is
      // exact, so passing what the agent typed returns None — and None means
      // "no channel you are a member of", which is deliberately the same answer
      // a non-member gets. A caller's mistake would arrive as an agent being
      // told it is not in a channel it is in, with nothing anywhere saying why.
      //
      // Dying names the offending caller in a stack trace instead. The same
      // judgement this seam makes about every misuse of it: a build mistake is not
      // a condition an agent caused or an operator can retry.
      if (name !== canonicalChannelName(name)) {
        return yield* Effect.die(
          new Error(
            `ChannelGateway.getChannelForMember called with a non-canonical name: <${name}>`,
          ),
        );
      }
      const row = yield* channels
        .getChannelByName(name)
        .pipe(Effect.mapError(() => storeUnavailable("getChannelForMember")));
      // THESE TWO `Option.none`s MUST STAY ONE ANSWER. A caller that can tell
      // "no such channel" from "exists, you are not in it" can enumerate
      // private channel names by probing. The seam held that structurally -
      // membership was a parameter of the lookup, so there was no ordering to
      // swap - and this implementation does not: the lookup runs first and
      // membership is a guard after it, so the property now rests on these two
      // branches returning the same value. Giving either one a distinguishing
      // result is a two-line change that no test currently reds
      // (`t3_bot-glu`), so it is written here rather than left to be noticed.
      if (Option.isNone(row)) {
        return Option.none<Channel>();
      }
      // Membership decides visibility, and an ARCHIVED channel still resolves:
      // readable, not postable. The refusal to post is the aggregate's and
      // arrives at createPost.
      // BOTH FIELDS, and the kind was a literal until this change. Comparing
      // only `memberId` is a mutation that has survived a full suite three
      // times in this repository - the decider's author lookup, the shell
      // stream's membership test, and this reactor's own wake filter - because
      // every channel fixture gives its members ids that differ in BOTH
      // fields, so the two implementations are indistinguishable against any
      // data we had (`t3_bot-46h`). The colliding roster that tells them apart
      // is in this change's tests.
      const isMember = row.value.members.some(
        (candidate) =>
          candidate.memberKind === member.memberKind && candidate.memberId === member.memberId,
      );
      return isMember ? Option.some(toChannel(row.value)) : Option.none<Channel>();
    });

  /**
   * An id the BRAND refuses is an id that is not found.
   *
   * `ChannelPostId` rejects anything outside its charset (`t3_bot-2d2`), and
   * `.make` throws on rejection. Calling it in an argument list threw while
   * `channels.getPost(...)` was being CALLED — before
   * `.pipe(Effect.catchCause(writeDefect))` in `handlers.ts` had been attached
   * to anything — so the guard written for exactly this never ran, and a
   * `comms_reply` carrying "a:b" or "has space" died instead of failing typed.
   * `parentPostId` is agent-supplied and the tool schema checks only that it is
   * non-empty, so every one of those is reachable.
   *
   * Decoded through the brand rather than re-spelling its charset here: the
   * rule lives in `packages/contracts` and a second copy of it is the defect
   * that broke handle matching four times in one evening. Absence is the honest
   * answer — no post can carry an id the type cannot hold — and the caller's
   * existing not-found branch already says so to the agent.
   */
  const decodePostId = Schema.decodeUnknownOption(ChannelPostId);

  const getPost = (channelId: string, postId: string) =>
    // SUSPENDED for the same reason `readPosts` is: `Option.match` runs
    // `onSome` immediately, so `ChannelId.make` would be evaluated while this
    // function is being CALLED and its throw would escape before any Effect
    // existed. The toolkit's channelId comes from a resolved `Channel` and is
    // safe by provenance - but this signature takes a bare `string`, the seam
    // is written for callers that do not exist yet, and the next one holds
    // values from a browser. "Every caller passes something safe" is the
    // ordering argument wearing a different coat.
    Effect.suspend(() =>
      Option.match(decodePostId(postId), {
        onNone: () => Effect.succeedNone,
        onSome: (id) =>
          channels.getPost({ channelId: ChannelId.make(channelId), postId: id }).pipe(
            Effect.map(Option.map(toPost)),
            Effect.mapError(() => storeUnavailable("getPost")),
          ),
      }),
    );

  /**
   * A cursor this layer did not issue is a DEFECT, not an empty page.
   *
   * The toolkit's schema admits only 1-15 digits, so a cursor arriving here
   * that is not a safe non-negative integer is a caller bug. Dying says so;
   * coercing with `Number()` answered it with the wire shape of "you are caught
   * up", which is the one wrong answer an agent cannot detect - it stops
   * reading.
   *
   * THE DIGIT BOUND IS WHAT MAKES THIS UNREACHABLE, and it was not there at
   * first: `^[0-9]+$` admitted "9007199254740993", which is numeric, reached
   * this function, and threw while the argument to `listPosts` was being built
   * - before `Effect.catchCause(readDefect)` had anything to attach to. Agent
   * input became a server defect. If the bound in `tools.ts` is ever widened,
   * this throw becomes agent-reachable again and has to become a typed refusal
   * instead.
   */
  /**
   * A cursor names the channel it came from, and one from elsewhere is REFUSED.
   *
   * It used to be the bare event sequence. That sequence is GLOBAL, so a cursor
   * earned in another channel was well-formed digits that matched no row here,
   * and the read returned an empty page with `nextCursor: null` - byte for byte
   * the answer for "you are caught up". Measured before the fix: a second
   * channel holding three unread posts reported itself caught up to a caller
   * holding the first channel's cursor, and nothing in the reply said otherwise
   * (`t3_bot-e60`).
   *
   * Split on the FIRST colon. `t3_bot-2d2` forbids ":" inside a `ChannelId`, so
   * today the first and last colon are the same one - but the wake key already
   * paid once for assuming a delimiter could not appear in an id, and taking
   * the first is correct whether or not that rule survives.
   */
  const decodeCursor = (channelId: string, cursor: string) => {
    const boundary = cursor.indexOf(":");
    if (boundary === -1) {
      return Option.none<number>();
    }
    const issuedBy = cursor.slice(0, boundary);
    const digits = cursor.slice(boundary + 1);
    // DIGITS BEFORE `Number()`, because `Number()` is laxer than the schema
    // that feeds this and this function is also the door a DIRECT caller uses.
    // `Number("")` is 0, `Number("0x2")` is 2, `Number(" 3 ")` is 3,
    // `Number("1e2")` is 100 - so `"<channel>:"` decoded to sequence 0 and the
    // read answered it with the FIRST PAGE. An empty-looking page that is
    // really "here is the start again" is the same class of lie this whole
    // change exists to remove, reachable at the seam rather than through the
    // tool.
    if (!/^[0-9]+$/.test(digits)) {
      return Option.none<number>();
    }
    const sequence = Number(digits);
    // BOTH halves, and the channel half first: a cursor for another channel is
    // the defect this exists for, and a caller that gets the right refusal for
    // the wrong reason has learned nothing. Compared EXACTLY - a length or
    // prefix comparison passes every obvious test fixture and pages the wrong
    // channel on a seeded install, where two channel ids share a prefix and a
    // length.
    if (issuedBy !== channelId || !Number.isSafeInteger(sequence) || sequence < 0) {
      return Option.none<number>();
    }
    return Option.some(sequence);
  };

  const encodeCursor = (channelId: string, sequence: number) => `${channelId}:${sequence}`;

  const readPosts = (input: ReadPostsInput) =>
    Effect.suspend(() => {
      // REFUSED rather than answered. Returning an empty page here is the
      // original defect wearing the fix's clothes: the caller cannot tell it
      // from the end of the channel.
      const decoded =
        input.cursor === undefined
          ? Option.some(undefined)
          : decodeCursor(input.channelId, input.cursor);
      if (Option.isNone(decoded)) {
        return Effect.fail<ChannelCursorUnusable | ChannelStoreUnavailable>(
          // `input.cursor` is defined on this branch: an absent cursor took the
          // `Option.some(undefined)` path above and cannot reach here.
          new ChannelCursorUnusable({ cursor: input.cursor!, channelId: input.channelId }),
        );
      }
      const at = decoded.value;
      const channelId = ChannelId.make(input.channelId);
      // OVER-FETCH BY ONE. `nextCursor` has to say whether another post exists
      // in that direction, and asking for one more than the caller wanted is
      // how to know without a second query.
      const rows =
        input.direction === "forward"
          ? channels.listPosts({ channelId, limit: input.limit + 1, afterSequence: at })
          : channels.listPostsBackward({ channelId, limit: input.limit + 1, beforeSequence: at });
      return rows.pipe(
        Effect.mapError(() => storeUnavailable("readPosts")),
        Effect.map((all) => {
          // BACKWARD DROPS FROM THE FRONT. The rows arrive ascending either
          // way, so the over-fetched row is the OLDEST one going backward and
          // the NEWEST one going forward. Slicing the tail in both directions
          // would silently discard the post the caller asked for and keep the
          // probe.
          const kept =
            input.direction === "forward" ? all.slice(0, input.limit) : all.slice(-input.limit);
          const more = all.length > input.limit;
          // The cursor comes off the ROW, before the map: ChannelPostRecord
          // drops `sequence`, so taking it afterwards is taking it from a shape
          // that no longer carries it. Forward points AFTER the last row
          // returned; backward points BEFORE the first.
          const edge = input.direction === "forward" ? kept.at(-1) : kept.at(0);
          return {
            posts: kept.map(toPost),
            nextCursor:
              more && edge !== undefined ? encodeCursor(input.channelId, edge.sequence) : null,
          } satisfies ChannelPage;
        }),
      );
    });

  const createPost = (input: CreatePostInput) =>
    Effect.gen(function* () {
      // The id is generated HERE, not taken from the agent: an id is an
      // identifier rather than text, and the one value a caller could use to
      // collide with an existing post is the one it does not supply.
      // orDie: a platform crypto failure is a defect, not something an agent
      // did or an operator fixes by retrying, and it must not arrive as one of
      // the seam's typed refusals.
      // DECODED, NOT CONSTRUCTED. `.make` throws on an id the brand refuses,
      // and this function declares five typed failures - so a direct caller
      // writing an exhaustive `catchTags` would look correct and still take a
      // raw schema Die carrying a serialised AST. The toolkit happens not to
      // reach it, because `comms_reply` passes the postId the projection
      // returned; that is provenance rather than call order, and it is still
      // a rule in another function. This PR removed that argument twice
      // already, and keeping a third instance annotated as the exception is
      // what makes the rule read as optional.
      //
      // A refusal is PERMANENT for this input, so it is not retryable: no
      // amount of trying again makes "a:b" a post id.
      const parent =
        input.parentPostId === null
          ? null
          : yield* Option.match(decodePostId(input.parentPostId), {
              onNone: () =>
                Effect.fail(
                  new ChannelWriteConflict({
                    detail: "the parent post id is not a post id",
                    retryable: false,
                  }),
                ),
              onSome: Effect.succeed,
            });
      const postId = `post-${(yield* crypto.randomUUIDv4.pipe(Effect.orDie)).replace(/-/g, "")}`;
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      yield* engine
        .dispatch(
          {
            type: "channel.post.create",
            commandId: CommandId.make(`comms-post:${postId}`),
            channelId: ChannelId.make(input.channelId),
            postId: ChannelPostId.make(postId),
            body: input.body,
            mentions: input.mentions.map((handle) => ChannelMemberHandle.make(handle)),
            parentPostId: parent,
            createdAt,
          },
          // THE ISSUER, NOT A COMMAND FIELD. The decider derives the author
          // from it and refuses a channel command that arrives without one, so
          // a gateway that omits this refuses every post while looking correct.
          { issuer: { memberKind: "thread", memberId: input.threadId } },
        )
        .pipe(
          Effect.mapError(
            (error) =>
              // TOLD APART BY TAG, not by prose. The dispatch error union has
              // the decider's own refusals as one member, and a refusal is
              // PERMANENT for the same input: a revoked membership, a mention
              // that no longer resolves. Everything else is infrastructure and
              // is worth trying again.
              //
              // An earlier version mapped all of it to retryable, on the
              // argument that telling them apart would mean matching the
              // decider's message text — true, and it stopped me looking for
              // the discriminator that was already exported. The result was an
              // agent told to "try again" on a post that could never land.
              //
              // THE DETAIL IS A CONSTANT, and the agent is told only WHETHER
              // rather than why. That is the trade and it is deliberate: the
              // decider's prose carried the internal channelId - "Author is not
              // a member of channel 'channel-seniors-t'" - which the tool
              // surface otherwise never hands an agent, since
              // `PostResult.channel` and `ReadChannelResult.channel` are both
              // the NAME. It also carried the phrase "Orchestration command
              // invariant failed". An agent can act on `retryable`; it can act
              // on neither of those.
              //
              // What it COSTS is real and should not be read as free: a
              // membership revoked between the check and the write now reaches
              // the agent as "the channel refused the post", permanently, with
              // no reason. `t3_bot-dnz` is where the decider gains a
              // machine-readable reason so this can say why without quoting
              // English.
              new ChannelWriteConflict({
                detail: "the channel refused the post",
                retryable: !isOrchestrationCommandRejection(error),
              }),
          ),
        );
      return { postId, createdAt };
    });

  return ChannelGateway.of({ getChannelForMember, getPost, readPosts, createPost });
});

/** The live layer, and the only implementation the server builds. */
export const ChannelGatewayLive = Layer.effect(ChannelGateway, make);
