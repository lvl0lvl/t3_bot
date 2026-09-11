/**
 * The seam between the comms toolkit and the channel aggregate.
 *
 * The aggregate — `channel.*` commands, the channel projection, and the id
 * types — is t3_bot-wmd and lands in t3_bot-yyd. This interface is the agreed
 * shape (board 2026-09-11-180001-boss1-005 and 2026-09-11-180105-boss3-003) so
 * the toolkit, its capability wiring, and its tests are complete before those
 * symbols exist. `ChannelGatewayUnavailable` is the layer until then; swapping
 * in the live layer changes nothing above this file.
 *
 * Ids are `string` here on purpose. They become the aggregate's branded types
 * when it lands, and every one of them travels through this file, so widening
 * them is a change to this module and its live layer only.
 *
 * @module channelGateway
 */
import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Option from "effect/Option";

/**
 * A channel member. `memberId` of a thread member is its `ThreadId`, but the
 * field is never named `threadId`: a `threadId` at the top level of a
 * `channel.*` payload routes the command to the wrong aggregate, silently
 * (board 2026-09-11-180121-boss1-006, ratified 2026-09-11-180140-pm-007).
 */
export interface ChannelMember {
  /** What the agent types to mention this member, without the leading "@". */
  readonly handle: string;
  readonly memberKind: "thread" | "human";
  readonly memberId: string;
}

export interface Channel {
  readonly channelId: string;
  /** Canonical name, without the leading "#". */
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

export interface CreatePostInput {
  readonly channelId: string;
  /** Always the calling thread; the toolkit never accepts an author argument. */
  readonly authorThreadId: ThreadId;
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
  readonly limit: number;
  readonly cursor: string | undefined;
}

export interface ChannelGatewayShape {
  /**
   * The channel by name, but only if `threadId` is a member of it. A
   * non-member and a non-existent channel are the same answer: an agent must
   * not be able to probe for channels it is not in.
   */
  readonly getChannelForMember: (
    name: string,
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<Channel>>;
  readonly createPost: (input: CreatePostInput) => Effect.Effect<CreatedPost>;
  readonly readPosts: (input: ReadPostsInput) => Effect.Effect<ChannelPage>;
}

export class ChannelGateway extends Context.Service<ChannelGateway, ChannelGatewayShape>()(
  "t3/mcp/toolkits/comms/channelGateway",
) {}

/**
 * Defect rather than a typed failure: reaching this means the live layer was
 * not wired, which is a build mistake, not a condition an agent can cause or
 * an operator can fix by retrying. The toolkit maps it to a failed tool call
 * like any other defect.
 */
const notWired = (operation: string) =>
  Effect.die(new Error(`ChannelGateway.${operation} called before the channel aggregate landed.`));

/** Stands in until t3_bot-yyd lands the aggregate. */
export const ChannelGatewayUnavailable = Layer.succeed(
  ChannelGateway,
  ChannelGateway.of({
    getChannelForMember: () => notWired("getChannelForMember"),
    createPost: () => notWired("createPost"),
    readPosts: () => notWired("readPosts"),
  }),
);
