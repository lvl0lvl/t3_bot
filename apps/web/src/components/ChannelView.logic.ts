import type { ChannelSupport, EnvironmentChannelShell } from "@t3tools/client-runtime/state/shell";

/**
 * What the channel route renders, as four named outcomes.
 *
 * "unavailable" and "unsupported" are the pair worth naming. A channel the
 * client does not hold and a server that has no channels both produce no
 * channel, and they need opposite messages: being added to a channel fixes the
 * first and cannot fix the second. Telling an operator to ask for an invite to a
 * server that has none wastes their time and hides the real problem, which is
 * the server's version.
 *
 * "loading" EXISTS BECAUSE ITS ABSENCE WAS A LIE. This was three outcomes over
 * a boolean, so a snapshot still in flight fell into "unsupported" and the route
 * told the operator to update a server that was working — on every reload while
 * sitting on a channel URL. A state the code cannot express is a state the code
 * gets wrong.
 *
 * The client cannot separate "no such channel" from "you are not a member", and
 * does not try: the server sends only the channels the member is in, so the two
 * are one fact on this side of the wire.
 */
export type ChannelViewState = "ready" | "loading" | "unavailable" | "unsupported";

export function resolveChannelViewState(input: {
  readonly channelExists: boolean;
  readonly support: ChannelSupport;
}): ChannelViewState {
  // HOLDING THE CHANNEL IS THE STRONGEST FACT and is checked first. A live
  // `channel-upserted` can arrive against a snapshot that carried no channels
  // field, so a view that checked support first would blank a channel it could
  // render.
  if (input.channelExists) {
    return "ready";
  }
  if (input.support === "unknown") {
    return "loading";
  }
  return input.support === "supported" ? "unavailable" : "unsupported";
}

/**
 * Whether the composer is offered.
 *
 * ARCHIVED IS NOT READ-ONLY BY CONVENTION — the decider refuses a post to an
 * archived channel, so offering a composer there offers an action that cannot
 * succeed. The reverse state is a stated reason rather than a disabled button
 * with no explanation.
 */
export type ChannelComposerState = "open" | "archived";

export function resolveChannelComposerState(
  channel: Pick<EnvironmentChannelShell, "archivedAt">,
): ChannelComposerState {
  return channel.archivedAt === null ? "open" : "archived";
}

/**
 * Whether a typed body can be sent.
 *
 * The TRIMMED body is what decides, and it is also what gets sent: a composer
 * that enables Send on whitespace dispatches a command the decider refuses,
 * because `channel.post.create` takes a trimmed non-empty string. Checking the
 * raw length would make the button live for a body of spaces.
 */
export function canSendChannelPost(input: {
  readonly body: string;
  readonly sending: boolean;
}): boolean {
  return input.body.trim().length > 0 && !input.sending;
}
