/**
 * The live ChannelGateway: the seam's shapes, answered from the channel
 * projection and the orchestration engine.
 *
 * Everything above this file is written against `channelGateway.ts` and does
 * not change when this layer replaces `ChannelGatewayUnavailable`. What is here
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

import { isOrchestrationCommandRejection } from "../../../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import {
  ProjectionChannelRepository,
  type ProjectionChannel,
  type ProjectionChannelPost,
} from "../../../persistence/Services/ProjectionChannels.ts";
import {
  ChannelArchived,
  ChannelGateway,
  ChannelStoreUnavailable,
  ChannelWriteConflict,
  type Channel,
  type ChannelPage,
  type ChannelPostRecord,
  type CreatePostInput,
  type ReadPostsInput,
} from "./channelGateway.ts";

/**
 * A projection read that failed is the store not answering, which is what the
 * seam's one read error means. The detail names the OPERATION rather than
 * carrying the cause's text: the cause belongs in the log, and this string is
 * read by an agent.
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

  const getChannelForMember = (name: string, threadId: string) =>
    Effect.gen(function* () {
      // A NON-CANONICAL NAME IS A DEFECT, not a typed failure. Matching here is
      // exact, so passing what the agent typed returns None — and None means
      // "no channel you are a member of", which is deliberately the same answer
      // a non-member gets. A caller's mistake would arrive as an agent being
      // told it is not in a channel it is in, with nothing anywhere saying why.
      //
      // Dying names the offending caller in a stack trace instead. Same
      // judgement `notWired` already makes in this seam: a build mistake is not
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
      if (Option.isNone(row)) {
        return Option.none<Channel>();
      }
      // Membership decides visibility, and an ARCHIVED channel still resolves:
      // readable, not postable. The refusal to post is the aggregate's and
      // arrives at createPost.
      const isMember = row.value.members.some(
        (member) => member.memberKind === "thread" && member.memberId === threadId,
      );
      return isMember ? Option.some(toChannel(row.value)) : Option.none<Channel>();
    });

  const getPost = (channelId: string, postId: string) =>
    channels
      .getPost({ channelId: ChannelId.make(channelId), postId: ChannelPostId.make(postId) })
      .pipe(
        Effect.map(Option.map(toPost)),
        Effect.mapError(() => storeUnavailable("getPost")),
      );

  /**
   * A cursor this layer did not issue is a DEFECT, not an empty page.
   *
   * The toolkit's schema refuses a non-numeric cursor before the call, so
   * anything arriving here malformed is a caller bug. Dying says so; coercing
   * with `Number()` answered it with the wire shape of "you are caught up",
   * which is the one wrong answer an agent cannot detect - it stops reading.
   */
  const requireSequence = (cursor: string) => {
    const sequence = Number(cursor);
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new Error(`ChannelGatewayLive received a cursor that is not a sequence: ${cursor}`);
    }
    return sequence;
  };

  const readPosts = (input: ReadPostsInput) =>
    // OVER-FETCH BY ONE. `nextCursor` has to say whether a newer post exists,
    // and asking for one more than the caller wanted is how to know without a
    // second query.
    channels
      .listPosts({
        channelId: ChannelId.make(input.channelId),
        limit: input.limit + 1,
        afterSequence: input.cursor === undefined ? undefined : requireSequence(input.cursor),
      })
      .pipe(
        Effect.mapError(() => storeUnavailable("readPosts")),
        Effect.map((rows) => {
          const kept = rows.slice(0, input.limit);
          // The cursor comes off the ROW, before the map: ChannelPostRecord
          // drops `sequence`, so taking it afterwards is taking it from a shape
          // that no longer carries it.
          const last = kept.at(-1);
          return {
            posts: kept.map(toPost),
            nextCursor:
              rows.length > input.limit && last !== undefined ? String(last.sequence) : null,
          } satisfies ChannelPage;
        }),
      );

  const createPost = (input: CreatePostInput) =>
    Effect.gen(function* () {
      // Read the channel to refuse an archived one PRECISELY. The aggregate
      // refuses it too and is the enforcement point; what this buys is an
      // agent-readable reason, because the aggregate's refusal arrives as one
      // invariant error among several and telling them apart would mean
      // matching on its message.
      const row = yield* channels
        .getChannelById(ChannelId.make(input.channelId))
        .pipe(Effect.mapError(() => storeUnavailable("createPost")));
      if (Option.isSome(row) && row.value.archivedAt !== null) {
        return yield* new ChannelArchived();
      }

      // The id is generated HERE, not taken from the agent: an id is an
      // identifier rather than text, and the one value a caller could use to
      // collide with an existing post is the one it does not supply.
      // orDie: a platform crypto failure is a defect, not something an agent
      // did or an operator fixes by retrying, and it must not arrive as one of
      // the seam's typed refusals.
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
            parentPostId:
              input.parentPostId === null ? null : ChannelPostId.make(input.parentPostId),
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
              // The detail carries the aggregate's own words either way, so
              // the agent sees WHY rather than only whether.
              new ChannelWriteConflict({
                detail: "message" in error ? String(error.message) : "the post was refused",
                retryable: !isOrchestrationCommandRejection(error),
              }),
          ),
        );
      return { postId, createdAt };
    });

  return ChannelGateway.of({ getChannelForMember, getPost, readPosts, createPost });
});

/** The live layer. Replaces `ChannelGatewayUnavailable` in the merged server layer. */
export const ChannelGatewayLive = Layer.effect(ChannelGateway, make);
