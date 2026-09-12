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
// ONE IMPLEMENTATION of the cursor format, in `orchestration/channelCursor.ts`.
// It used to live in this file; the browser's paged read is a second door onto
// the same format, and a format whose refusal looks like an empty page cannot
// afford two decoders — nor two copies of the paging arithmetic that decides what
// a cursor points at, which is why `resolveChannelPostPage` comes from there too.
import {
  channelPostOverFetch,
  decodeChannelCursor as decodeCursor,
  resolveChannelPostPage,
  type ChannelCursorRefusal,
} from "../../../orchestration/channelCursor.ts";
import { wakesForPosts } from "../../../orchestration/channelPostWakes.ts";
import { ChannelPostWakeRepositoryLive } from "../../../persistence/Layers/ChannelPostWakes.ts";
import { ChannelPostWakeRepository } from "../../../persistence/Services/ChannelPostWakes.ts";
import { ProjectionTurnRepositoryLive } from "../../../persistence/Layers/ProjectionTurns.ts";
import { ProjectionTurnRepository } from "../../../persistence/Services/ProjectionTurns.ts";
import * as Context from "effect/Context";
import * as Result from "effect/Result";
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
  type ChannelPostWakeRecord,
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

const toPost = (
  row: ProjectionChannelPost,
  wakes: ReadonlyArray<ChannelPostWakeRecord> | undefined,
): ChannelPostRecord => ({
  postId: row.postId,
  authorHandle: row.authorHandle,
  body: row.body,
  mentions: [...row.mentions],
  parentPostId: row.parentPostId,
  createdAt: row.createdAt,
  // Spread, not assigned: an explicit `wakes: undefined` is a present key, and
  // the handler's `satisfies` and the tool's JSON would disagree about it.
  ...(wakes === undefined ? {} : { wakes }),
});

const make = Effect.gen(function* () {
  const channels = yield* ProjectionChannelRepository;
  const engine = yield* OrchestrationEngineService;
  // ACQUIRED ONCE AND CLOSED OVER, like `channels`: the seam's methods promise
  // `never` in their context slot, so the join's two repositories cannot be
  // left as a requirement on `readPosts` for a caller to supply per call.
  const wakeContext = Context.make(
    ChannelPostWakeRepository,
    yield* ChannelPostWakeRepository,
  ).pipe(Context.add(ProjectionTurnRepository, yield* ProjectionTurnRepository));
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
      // stream's membership test, and the mention-wake reactor's filter - because
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
            // NO WAKES ON THIS PATH, and that is a decision rather than an
            // omission: `getPost` exists so `reply` can check a parent exists,
            // and the answer it needs is yes or no. Joining wakes here would
            // cost two queries per reply to decorate a value nobody reads.
            Effect.map(Option.map((row) => toPost(row, undefined))),
            Effect.mapError(() => storeUnavailable("getPost")),
          ),
      }),
    );

  const readPosts = (input: ReadPostsInput) =>
    Effect.suspend(() => {
      // REFUSED rather than answered. Returning an empty page here is the
      // original defect wearing the fix's clothes: the caller cannot tell it
      // from the end of the channel.
      const decoded: Result.Result<number | undefined, ChannelCursorRefusal> =
        input.cursor === undefined
          ? Result.succeed(undefined)
          : decodeCursor(input.channelId, input.direction, input.cursor);
      if (Result.isFailure(decoded)) {
        return Effect.fail<ChannelCursorUnusable | ChannelStoreUnavailable>(
          // `input.cursor` is defined on this branch: an absent cursor took the
          // `Result.succeed(undefined)` path above and cannot reach here.
          // THE REASON IS CARRIED, not re-derived: this is the only place that
          // knows which of the three refusals fired, and the toolkit turns it
          // into the sentence the agent reads.
          new ChannelCursorUnusable({
            cursor: input.cursor!,
            channelId: input.channelId,
            reason: decoded.failure,
          }),
        );
      }
      const at = decoded.success;
      const channelId = ChannelId.make(input.channelId);
      const overFetch = channelPostOverFetch(input.limit);
      const rows =
        input.direction === "forward"
          ? channels.listPosts({ channelId, limit: overFetch, afterSequence: at })
          : channels.listPostsBackward({ channelId, limit: overFetch, beforeSequence: at });
      return rows.pipe(
        Effect.mapError(() => storeUnavailable("readPosts")),
        Effect.map((all) => {
          // The page arithmetic is `resolveChannelPostPage`, beside the codec,
          // because this door and the client door have to agree about it — they
          // held two copies that were equal only while the store returned exactly
          // what LIMIT asked for. The cursor comes off the ROW, before the map:
          // `ChannelPostRecord` drops `sequence`.
          const page = resolveChannelPostPage({
            channelId: input.channelId,
            direction: input.direction,
            limit: input.limit,
            rows: all,
          });
          return page;
        }),
        // THE WAKE JOIN, after the page is cut so the over-fetched row's wakes
        // are never fetched. Same function as the client door, beside the
        // codec, for the same reason the paging arithmetic is: the mapping from
        // a turn's lifecycle to a wake's outcome is a decision, and this door
        // and that one must not hold two copies of it.
        Effect.flatMap((page) =>
          wakesForPosts({
            channelId: input.channelId,
            postIds: page.rows.map((row) => row.postId),
          }).pipe(
            Effect.provide(wakeContext),
            Effect.mapError(() => storeUnavailable("readPosts")),
            Effect.map(
              (wakes) =>
                ({
                  posts: page.rows.map((row) => toPost(row, wakes.get(row.postId))),
                  nextCursor: page.nextCursor,
                }) satisfies ChannelPage,
            ),
          ),
        ),
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
// THE TWO REPOSITORIES THE WAKE JOIN READS, provided here rather than demanded
// of every caller: the comms toolkit's callers wire `ChannelGatewayLive` as a
// leaf, and a leaf that grows a requirement breaks each of them at the
// composition site rather than at the change. The pipeline provides the same
// two to the client door; this is the gateway's own copy of the same wiring.
export const ChannelGatewayLive = Layer.effect(ChannelGateway, make).pipe(
  Layer.provide(ChannelPostWakeRepositoryLive),
  Layer.provide(ProjectionTurnRepositoryLive),
);
