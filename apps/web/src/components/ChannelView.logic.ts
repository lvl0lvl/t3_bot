import type { EnvironmentChannelShell } from "@t3tools/client-runtime/state/shell";

/**
 * What the channel route renders, as three named outcomes.
 *
 * "unavailable" and "unsupported" are the pair worth naming. A channel the
 * client does not hold and a server that has no channels both produce no
 * channel, and they need opposite messages: being added to a channel fixes the
 * first and cannot fix the second. Telling an operator to ask for an invite to a
 * server that has none wastes their time and hides the real problem, which is
 * the server's version.
 *
 * The client cannot separate "no such channel" from "you are not a member", and
 * does not try: the server sends only the channels the member is in, so the two
 * are one fact on this side of the wire.
 */
export type ChannelViewState = "ready" | "unavailable" | "unsupported";

export function resolveChannelViewState(input: {
  readonly channelExists: boolean;
  readonly serverSupportsChannels: boolean;
}): ChannelViewState {
  if (input.channelExists) {
    return "ready";
  }
  return input.serverSupportsChannels ? "unavailable" : "unsupported";
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
