import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { ChannelSupport, EnvironmentChannelShell } from "@t3tools/client-runtime/state/shell";
import { AsyncResult } from "effect/unstable/reactivity";

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
 * What to do with the result of a send.
 *
 * THREE OUTCOMES, because the composer has three and they are not orderable by
 * severity: a success clears the draft, an INTERRUPT does neither (a cancelled
 * send is not a failure, and the three sibling call sites in this app all bail
 * on it first), and a real failure keeps the draft AND reports why.
 *
 * Extracted because it was the fourth decision in this component and the only
 * one left in JSX — and then grew from one branch to three there, untested,
 * while the other three each had tests. Taking two booleans rather than the
 * `AsyncResult` keeps this free of Effect types and makes the interrupt case
 * expressible as an input, which is the combination no single boolean carries.
 */
export type SendOutcome =
  | { readonly kind: "clear-draft" }
  | { readonly kind: "ignore" }
  | { readonly kind: "report-failure"; readonly message: string };

/**
 * Shown when a refusal arrives as something that is not an `Error`.
 *
 * A cause can squash to a string, a tagged error, or anything a provider threw,
 * and `String(unknown)` can produce "[object Object]" — which tells the operator
 * nothing about a post they still have in the box.
 */
const UNKNOWN_FAILURE = "An unexpected error occurred.";

export function resolveSendOutcome(result: AtomCommandResult<unknown, unknown>): SendOutcome {
  if (AsyncResult.isSuccess(result)) {
    return { kind: "clear-draft" };
  }
  // Checked BEFORE reporting, and reachable only once the success case has
  // returned — a success carries no `cause`, so this is not callable on one.
  // That is why the parameter is the RESULT and not two booleans: they are not
  // independently available at the call site, and `AtomCommandResult` does not
  // narrow on its tag, so the narrowing has to happen here.
  //
  // An interrupt that raised "Could not post" would be a lie about an action
  // the operator themselves cancelled.
  if (isAtomCommandInterrupted(result)) {
    return { kind: "ignore" };
  }
  // THE MESSAGE COMES BACK WITH THE OUTCOME so the caller never touches the
  // result again. It was a `squashAtomCommandFailure` at the call site, where
  // control flow through the outcome meant the result no longer narrowed to a
  // failure — and the `instanceof Error` fallback it guarded was untested.
  const error = squashAtomCommandFailure(result);
  return {
    kind: "report-failure",
    message: error instanceof Error ? error.message : UNKNOWN_FAILURE,
  };
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

/**
 * A channel's posts as the view holds them: ascending, no duplicates.
 *
 * THE VIEW ACCUMULATES AND THE SERVER PAGES, so something has to merge, and the
 * merge is here rather than inside a component because it is the part with a
 * wrong answer available. Paging upward prepends an older page; a live reply
 * appends a newer post; and an optimistic post is later re-read from the server
 * under the same id.
 *
 * DE-DUPLICATED BY ID, which is what makes the optimistic append safe: the post
 * the client showed immediately and the post the next read returns are ONE post,
 * and a merge that kept both would show the operator their own message twice.
 * The INCOMING copy wins, because it came from the server and the local one was
 * a prediction.
 *
 * ORDERED BY `createdAt`, NOT BY SEQUENCE, because there is no sequence on the
 * wire — it is the cursor's other half and a client holding both halves could
 * build a cursor for any channel. The id is the tie-break, so two posts sharing
 * a timestamp still have one stable order instead of an order that depends on
 * which page happened to arrive first.
 */
export function mergeChannelPosts<
  A extends { readonly id: string; readonly createdAt: string },
>(input: { readonly existing: ReadonlyArray<A>; readonly incoming: ReadonlyArray<A> }): Array<A> {
  const byId = new Map<string, A>();
  for (const post of input.existing) {
    byId.set(post.id, post);
  }
  for (const post of input.incoming) {
    byId.set(post.id, post);
  }
  return [...byId.values()].sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.id.localeCompare(right.id)
      : left.createdAt < right.createdAt
        ? -1
        : 1,
  );
}
