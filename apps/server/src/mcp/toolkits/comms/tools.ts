import { CHANNEL_POST_PAGE_LIMIT_MAX, McpCapabilityUnavailableError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ChannelGateway from "./channelGateway.ts";

const dependencies = [McpInvocationContext.McpInvocationContext, ChannelGateway.ChannelGateway];

/**
 * The agent never names itself. Author identity is the calling thread, taken
 * from the MCP credential, so an agent cannot post as another member or as a
 * human. Carried by the two write tools because that is where an agent would
 * otherwise look for an author argument and invent one in the body; the read
 * tool has no authorship to mistake.
 */
const AUTHOR_IS_YOU =
  "You post as yourself; the channel records the author from your session. There is no author argument.";

export const MAX_MENTIONS = 32;
export const MAX_POST_BODY_CHARS = 16_000;
/**
 * THE SAME CEILING AS THE CLIENT DOORS', not a second spelling of 200.
 *
 * `comms_read_posts` reaches `ProjectionChannelRepository.listPostsBackward` — the
 * same read the socket RPC and its HTTP twin make — so three doors bound one query.
 * This was its own `200`, which made `CHANNEL_POST_PAGE_LIMIT_MAX`'s claim to be
 * "the one place the ceiling lives" false about the read it governs, and invited the
 * drift it warns about: raise the ceiling, change one constant, leave this door.
 */
export const MAX_READ_LIMIT = CHANNEL_POST_PAGE_LIMIT_MAX;

/**
 * What an agent gets when it does not ask, which is NOT the browser's page size.
 *
 * `CHANNEL_POST_PAGE_SIZE` in `ChannelView.tsx` is also 50 and is deliberately not
 * shared with this: that one is "what fills a tall pane once with room to scroll",
 * this one is "how much history an agent should read without saying so". They agree
 * today by coincidence, and coupling them would let a change to the browser's layout
 * silently change what every agent reads.
 */
export const DEFAULT_READ_LIMIT = 50;

/**
 * Descriptions live on the struct fields rather than on the string types.
 * `TrimmedNonEmptyString` is a transformation, so an annotation applied to it
 * is dropped from the encoded JSON schema the agent receives, along with its
 * non-empty check. Annotating the field keeps both visible.
 */
const ChannelField = Schema.String.check(Schema.isNonEmpty()).annotate({
  description:
    "Channel name, with or without the leading '#', for example '#seniors' or 'seniors'. Must be a channel you are a member of.",
});

const BodyField = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(MAX_POST_BODY_CHARS));

const MentionsField = Schema.Array(Schema.String)
  .check(Schema.isMaxLength(MAX_MENTIONS))
  .annotate({
    description: `Member handles to mention, with or without the leading '@', for example '@boss1'. Mentioning a member wakes it: it receives this post as a message on its own thread. Mention only the members who need to act. At most ${MAX_MENTIONS}.`,
  });

export class CommsChannelNotFoundError extends Schema.TaggedError<CommsChannelNotFoundError>()(
  "CommsChannelNotFoundError",
  { channel: Schema.String },
) {
  override get message(): string {
    return `No channel named '${this.channel}' that you are a member of.`;
  }
}

export class CommsMemberNotFoundError extends Schema.TaggedError<CommsMemberNotFoundError>()(
  "CommsMemberNotFoundError",
  { handles: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return `Not members of this channel: ${this.handles.join(", ")}. Use comms_read_channel to see who is.`;
  }
}

export class CommsPostNotFoundError extends Schema.TaggedError<CommsPostNotFoundError>()(
  "CommsPostNotFoundError",
  { postId: Schema.String },
) {
  override get message(): string {
    return `No post ${this.postId} in this channel.`;
  }
}

export class CommsEmptyBodyError extends Schema.TaggedError<CommsEmptyBodyError>()(
  "CommsEmptyBodyError",
  {},
) {
  override get message(): string {
    return "The message is empty once whitespace is removed. Nothing was posted.";
  }
}

export class CommsMembershipLostError extends Schema.TaggedError<CommsMembershipLostError>()(
  "CommsMembershipLostError",
  {},
) {
  override get message(): string {
    return "You were removed from this channel while the post was being written. Nothing was posted.";
  }
}

/**
 * The cursor did not come from this channel, so the read was refused.
 *
 * TOLD, rather than answered with an empty page. A cursor is a global sequence
 * underneath, so one earned in another channel used to match no row here and
 * come back as "no posts, nothing newer" - which an agent reads as having
 * caught up, and it stops. The message says what to do instead, because the
 * agent cannot repair the cursor and should not try - and it says "the
 * beginning" rather than "the newest", because this tool reads oldest-first.
 */
export class CommsCursorUnusableError extends Schema.TaggedError<CommsCursorUnusableError>()(
  "CommsCursorUnusableError",
  { channel: Schema.String },
) {
  override get message() {
    return `That cursor was not issued by '${this.channel}'. Read the channel again without a cursor to start from the beginning, then follow nextCursor. Nothing was lost.`;
  }
}

/**
 * The channel is archived. Says so, rather than "not found".
 *
 * The agent can read this channel — it just resolved it — so an error claiming
 * it does not exist would be false to the one reader who can see otherwise, and
 * would send it to `comms_read_channel`, which would show the channel and no
 * reason for the refusal. It names the state and the one action that changes it.
 */
export class CommsChannelArchivedError extends Schema.TaggedError<CommsChannelArchivedError>()(
  "CommsChannelArchivedError",
  { channel: Schema.String },
) {
  override get message(): string {
    return `Channel '${this.channel}' is archived: you can read it, but nothing can be posted to it. Nothing was posted. Ask a human to unarchive it if this still needs saying.`;
  }
}

export class CommsPostFailedError extends Schema.TaggedError<CommsPostFailedError>()(
  "CommsPostFailedError",
  { detail: Schema.String, retryable: Schema.Boolean },
) {
  override get message(): string {
    return this.retryable
      ? `Could not post to the channel: ${this.detail}. Try again.`
      : `Could not post to the channel: ${this.detail}.`;
  }
}

export class CommsReadFailedError extends Schema.TaggedError<CommsReadFailedError>()(
  "CommsReadFailedError",
  { detail: Schema.String },
) {
  override get message(): string {
    return `Could not read the channel: ${this.detail}.`;
  }
}

export const CommsToolError = Schema.Union([
  McpCapabilityUnavailableError,
  CommsChannelNotFoundError,
  CommsChannelArchivedError,
  CommsCursorUnusableError,
  CommsMemberNotFoundError,
  CommsPostNotFoundError,
  CommsEmptyBodyError,
  CommsMembershipLostError,
  CommsPostFailedError,
  CommsReadFailedError,
]);
export type CommsToolError = typeof CommsToolError.Type;

export const PostResult = Schema.Struct({
  postId: Schema.String.annotate({
    description:
      "Identifies this post. Pass it as parentPostId to reply to it, and quote it when referring to this post later.",
  }),
  channel: Schema.String,
  createdAt: Schema.String,
  mentioned: Schema.Array(Schema.String).annotate({
    description: "Handles that were mentioned and will be woken by this post.",
  }),
});
export type PostResult = typeof PostResult.Type;

export const ChannelPost = Schema.Struct({
  postId: Schema.String,
  author: Schema.String.annotate({ description: "Handle of the member who wrote this post." }),
  body: Schema.String,
  mentions: Schema.Array(Schema.String),
  parentPostId: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});
export type ChannelPost = typeof ChannelPost.Type;

/**
 * A cursor is the `nextCursor` of an earlier read, handed back verbatim.
 *
 * Opaque to the agent, and `${channelId}:${sequence}` underneath. The channel
 * half is what makes a cursor from ANOTHER channel detectable: the sequence is
 * global, so a bare one matched no row here and the read answered with an empty
 * page - which is byte for byte "you are caught up" (`t3_bot-e60`).
 *
 * TWO BOUNDS, EACH LOAD-BEARING.
 *
 * The channel half repeats `OPAQUE_ID_PATTERN` from
 * `packages/contracts/src/baseSchemas.ts` rather than accepting anything up to
 * a colon, because the split assumes no ":" inside a channel id and this is
 * where that assumption is checkable. IT IS A SECOND SPELLING OF ONE RULE,
 * which this repo has been burned by four times - kept deliberately because a
 * schema pattern cannot reference a brand's internal regex, and recorded here
 * because the bead that introduced it (`t3_bot-2d2`) is CLOSED and is not where
 * anyone will look. If that charset widens, this pattern is wrong and so is
 * `decodeCursor`'s split.
 *
 * The sequence half stays at fifteen digits. `Number.MAX_SAFE_INTEGER` has
 * sixteen of them, so fifteen is the widest bound that cannot overflow. An
 * unbounded `[0-9]+` admitted "9007199254740993", which is numeric and passes
 * every other check; the gateway now REFUSES such a cursor rather than
 * defecting on it, so widening this costs a typed refusal rather than a crash -
 * but it still means handing an agent a cursor the server can never honour.
 */
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,64}:[0-9]{1,15}$/;

export const ReadChannelResult = Schema.Struct({
  channel: Schema.String,
  // NAMED FOR THE DECISION, not for the state. An agent reading this has one
  // question - can I write here - and `archived: true` makes it infer the
  // consequence from a word about the channel's lifecycle. Without the field
  // the only way to find out is to post and be refused, which costs a call and
  // still does not say whether the refusal is permanent.
  postable: Schema.Boolean.annotate({
    description:
      "False when the channel is archived: you can read it, and a post will be refused. Do not retry a post to an unpostable channel.",
  }),
  members: Schema.Array(Schema.String).annotate({
    description: "Handles of everyone in the channel, so you know who you can mention.",
  }),
  posts: Schema.Array(ChannelPost).annotate({
    description: "Oldest first. The first page is the oldest posts in the channel.",
  }),
  nextCursor: Schema.NullOr(
    Schema.String.annotate({
      description:
        "Pass as cursor to read the posts after this page, IN THIS CHANNEL ONLY — a cursor used on a different channel is refused, not answered. Null when there are no newer posts.",
    }),
  ),
});
export type ReadChannelResult = typeof ReadChannelResult.Type;

const PostTool = Tool.make("comms_post", {
  description: `Post a message to a channel you belong to. ${AUTHOR_IS_YOU} Mention a member to wake it — an unmentioned member sees the post only when it next reads the channel. To answer an existing post, use comms_reply instead so the conversation stays threaded.`,
  parameters: Schema.Struct({
    channel: ChannelField,
    body: BodyField.annotate({
      description: `The message. Must not be empty; at most ${MAX_POST_BODY_CHARS} characters.`,
    }),
    mentions: Schema.optional(MentionsField),
  }),
  success: PostResult,
  failure: CommsToolError,
  dependencies,
})
  .annotate(Tool.Title, "Post to a channel")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  // Two identical posts are two messages, not one. A retry duplicates.
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const ReplyTool = Tool.make("comms_reply", {
  description: `Reply to a post in a channel you belong to, keeping the conversation threaded under it. ${AUTHOR_IS_YOU} Replying does not wake the post's author: mention them if they need to act on it.`,
  parameters: Schema.Struct({
    channel: ChannelField,
    parentPostId: Schema.String.check(Schema.isNonEmpty()).annotate({
      description:
        "postId of the post being replied to, as returned by comms_post or comms_read_channel.",
    }),
    body: BodyField.annotate({
      description: `The reply. Must not be empty; at most ${MAX_POST_BODY_CHARS} characters.`,
    }),
    mentions: Schema.optional(MentionsField),
  }),
  success: PostResult,
  failure: CommsToolError,
  dependencies,
})
  .annotate(Tool.Title, "Reply to a post")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const ReadChannelTool = Tool.make("comms_read_channel", {
  description:
    "Read posts in a channel you belong to, oldest first, with the list of members you can mention. Use this to catch up before posting, and to find the postId you want to reply to. Read the next page by passing the nextCursor this returns.",
  parameters: Schema.Struct({
    channel: ChannelField,
    limit: Schema.optional(
      Schema.Int.check(
        Schema.isGreaterThanOrEqualTo(1),
        Schema.isLessThanOrEqualTo(MAX_READ_LIMIT),
      ).annotate({
        description: `Posts to return, 1 to ${MAX_READ_LIMIT}. Defaults to ${DEFAULT_READ_LIMIT}.`,
      }),
    ),
    cursor: Schema.optional(
      // DIGITS ONLY, checked here so a cursor that is not a cursor is refused
      // before any read rather than answered with an empty page. `Number()` on
      // an arbitrary string has no failure case: "post-2" and "abc" become NaN
      // and match no row, which reaches the agent as `nextCursor: null` - the
      // wire shape of "you are caught up" - while "  ", "-1" and "1.5" rewind
      // to the oldest page. A post id is the likely wrong value, since posts
      // and cursors are both bare strings in the result.
      Schema.String.check(Schema.isPattern(CURSOR_PATTERN)).annotate({
        description:
          "nextCursor from a previous read OF THIS CHANNEL, to get the posts after that page. Omit for the oldest posts. Pass it back exactly as given; a cursor from another channel is refused rather than answered.",
      }),
    ),
  }),
  success: ReadChannelResult,
  failure: CommsToolError,
  dependencies,
})
  .annotate(Tool.Title, "Read a channel")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const CommsToolkit = Toolkit.make(PostTool, ReplyTool, ReadChannelTool);
