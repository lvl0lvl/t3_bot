import {
  McpCapabilityUnavailableError,
  PositiveInt,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ChannelGateway from "./channelGateway.ts";

const dependencies = [McpInvocationContext.McpInvocationContext, ChannelGateway.ChannelGateway];

/**
 * The agent never names itself. Author identity is the calling thread, taken
 * from the MCP credential, so an agent cannot post as another member or as a
 * human. Repeated in every tool description because the alternative — an agent
 * looking for an author argument and inventing one in the body — is the failure
 * this design exists to prevent.
 */
const AUTHOR_IS_YOU =
  "You post as yourself; the channel records the author from your session. There is no author argument.";

export const ChannelNameInput = TrimmedNonEmptyString.annotate({
  description:
    "Channel name, with or without the leading '#', for example '#seniors' or 'seniors'. Must be a channel you are a member of.",
});

export const MentionsInput = Schema.Array(
  TrimmedNonEmptyString.annotate({
    description: "A member handle, with or without the leading '@', for example '@boss1'.",
  }),
).annotate({
  description:
    "Members to mention. Mentioning a member wakes it: it receives this post as a message on its own thread. Mention only the members who need to act on this post.",
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
    return `Not members of this channel: ${this.handles.join(", ")}. Use read_channel to see who is.`;
  }
}

export class CommsPostNotFoundError extends Schema.TaggedError<CommsPostNotFoundError>()(
  "CommsPostNotFoundError",
  { postId: Schema.String },
) {
  override get message(): string {
    return `Post ${this.postId} is not in this channel.`;
  }
}

export class CommsPostFailedError extends Schema.TaggedError<CommsPostFailedError>()(
  "CommsPostFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not post to the channel.";
  }
}

export class CommsReadFailedError extends Schema.TaggedError<CommsReadFailedError>()(
  "CommsReadFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read the channel.";
  }
}

export const CommsToolError = Schema.Union([
  McpCapabilityUnavailableError,
  CommsChannelNotFoundError,
  CommsMemberNotFoundError,
  CommsPostNotFoundError,
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

export const ReadChannelResult = Schema.Struct({
  channel: Schema.String,
  members: Schema.Array(Schema.String).annotate({
    description: "Handles of everyone in the channel, so you know who you can mention.",
  }),
  posts: Schema.Array(ChannelPost).annotate({ description: "Oldest first." }),
  nextCursor: Schema.NullOr(
    Schema.String.annotate({
      description: "Pass as cursor to read the next page. Null when this is the newest page.",
    }),
  ),
});
export type ReadChannelResult = typeof ReadChannelResult.Type;

const PostTool = Tool.make("post", {
  description: `Post a message to a channel you belong to. ${AUTHOR_IS_YOU} Mention a member to wake it — an unmentioned member sees the post only when it next reads the channel. To answer an existing post, use reply instead so the conversation stays threaded.`,
  parameters: Schema.Struct({
    channel: ChannelNameInput,
    body: TrimmedNonEmptyString.annotate({ description: "The message." }),
    mentions: Schema.optional(MentionsInput),
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

const ReplyTool = Tool.make("reply", {
  description: `Reply to a post in a channel you belong to, keeping the conversation threaded under it. ${AUTHOR_IS_YOU} Replying does not wake the post's author: mention them if they need to act on it.`,
  parameters: Schema.Struct({
    channel: ChannelNameInput,
    parentPostId: TrimmedNonEmptyString.annotate({
      description: "postId of the post being replied to, from post or read_channel.",
    }),
    body: TrimmedNonEmptyString.annotate({ description: "The reply." }),
    mentions: Schema.optional(MentionsInput),
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

const ReadChannelTool = Tool.make("read_channel", {
  description:
    "Read recent posts in a channel you belong to, oldest first, with the list of members you can mention. Use this to catch up before posting, and to find the postId you want to reply to.",
  parameters: Schema.Struct({
    channel: ChannelNameInput,
    limit: Schema.optional(
      PositiveInt.annotate({ description: "Posts to return. Defaults to 50, capped at 200." }),
    ),
    cursor: Schema.optional(
      TrimmedNonEmptyString.annotate({ description: "nextCursor from a previous read." }),
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
