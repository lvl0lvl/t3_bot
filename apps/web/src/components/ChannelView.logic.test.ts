import { describe, expect, it } from "vite-plus/test";

import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";

import {
  canSendChannelPost,
  mergeChannelPosts,
  resolveChannelComposerState,
  resolveChannelViewState,
  resolveSendOutcome,
} from "./ChannelView.logic";

describe("resolveChannelViewState", () => {
  it("renders the channel when the client holds it", () => {
    expect(resolveChannelViewState({ channelExists: true, support: "supported" })).toBe("ready");
  });

  it("says nothing about the server until the snapshot has arrived", () => {
    // THE DEFECT THIS STATE EXISTS FOR. With a boolean, "not asked yet" and "the
    // server has none" were one value, so every reload on a channel URL rendered
    // "This server has no channels. Update the server on that machine to use
    // them." — said to an operator about a server that was working fine.
    //
    // All THREE absences in one test, because "loading" alone would pass for an
    // implementation that returned it always, and the pair alone is what the
    // boolean version already satisfied.
    expect(resolveChannelViewState({ channelExists: false, support: "unknown" })).toBe("loading");
    expect(resolveChannelViewState({ channelExists: false, support: "supported" })).toBe(
      "unavailable",
    );
    expect(resolveChannelViewState({ channelExists: false, support: "unsupported" })).toBe(
      "unsupported",
    );
  });

  it("renders the channel it holds even before the snapshot says channels exist", () => {
    // Not contrived: a live `channel-upserted` can arrive against a snapshot
    // that carried no channels field, and on a reconnect the support state is
    // "unknown" while the channel is already held. Holding the channel is the
    // stronger fact, so it is checked FIRST — a view that checked support first
    // would blank a channel it could render, or wait for a snapshot forever.
    expect(resolveChannelViewState({ channelExists: true, support: "unsupported" })).toBe("ready");
    expect(resolveChannelViewState({ channelExists: true, support: "unknown" })).toBe("ready");
  });
});

describe("resolveChannelComposerState", () => {
  it("offers the composer on a live channel and withholds it on an archived one", () => {
    expect(resolveChannelComposerState({ archivedAt: null })).toBe("open");
    expect(resolveChannelComposerState({ archivedAt: "2026-04-01T00:00:00.000Z" })).toBe(
      "archived",
    );
  });
});

describe("resolveSendOutcome", () => {
  // The three real shapes the composer receives, not booleans standing in for
  // them. The earlier version of this took a `{succeeded, interrupted}` pair,
  // which cannot represent a result that is neither — and which let the test
  // agree with a signature the call site could not satisfy, because
  // `AtomCommandResult` does not narrow on its tag.
  const succeeded = AsyncResult.success({ sequence: 1 });
  const cancelled = AsyncResult.failure(Cause.interrupt());
  const refused = AsyncResult.failure(Cause.fail(new Error("Mentions do not resolve")));

  it("clears the draft only on success", () => {
    expect(resolveSendOutcome(succeeded)).toEqual({ kind: "clear-draft" });
  });

  it("keeps the draft and reports a real refusal", () => {
    // The draft survives because an unresolvable mention fails the WHOLE post:
    // clearing the box would lose what the operator typed, with no way back and
    // nothing on screen saying why.
    expect(resolveSendOutcome(refused)).toEqual({
      kind: "report-failure",
      message: "Mentions do not resolve",
    });
  });

  it("falls back to a readable message when the cause is not an Error", () => {
    // A cause can squash to a string or to anything a provider threw, and
    // `String(unknown)` can produce "[object Object]" — which tells an operator
    // nothing about a post still sitting in their box. This branch was inline
    // and untested before the outcome carried its own message.
    const odd = AsyncResult.failure(Cause.fail({ notAnError: true }));
    expect(resolveSendOutcome(odd)).toEqual({
      kind: "report-failure",
      message: "An unexpected error occurred.",
    });
  });

  it("does neither when the send was interrupted", () => {
    // THE CASE THAT NEEDS ITS OWN OUTCOME, and the reason there are three. An
    // interrupt IS a failure by tag, so a two-way decision raises "Could not
    // post" about an action the operator themselves cancelled. It must not
    // clear the draft either — the text is still wanted. Neither of the other
    // outcomes can express that.
    expect(resolveSendOutcome(cancelled)).toEqual({ kind: "ignore" });
  });
});

describe("canSendChannelPost", () => {
  it("refuses a body of only whitespace", () => {
    // The decider takes a trimmed non-empty string, so a Send that fired here
    // would dispatch a command guaranteed to be refused. A raw-length check
    // enables the button on these two inputs.
    expect(canSendChannelPost({ body: "   ", sending: false })).toBe(false);
    expect(canSendChannelPost({ body: "\n\t", sending: false })).toBe(false);
  });

  it("allows a body that is only whitespace at the ENDS", () => {
    // The other side of the trim: trailing whitespace is not an empty message,
    // and a check that refused any whitespace would refuse most real typing.
    expect(canSendChannelPost({ body: "  ship it  ", sending: false })).toBe(true);
  });

  it("refuses while a send is in flight", () => {
    // Otherwise a second Enter mints a second post id and posts twice — the
    // aggregate does not refuse a duplicate post, so both would commit.
    expect(canSendChannelPost({ body: "ship it", sending: true })).toBe(false);
  });
});

describe("mergeChannelPosts", () => {
  // `createdAt` stays on the fixture even though nothing orders by it any more,
  // because the bug was that something DID: a post carries one, and a fixture
  // that dropped it could not express "these tie".
  const post = (id: string, sequence: number, body = id) => ({
    id,
    sequence,
    createdAt: "2026-01-01T00:00:00.000Z",
    body,
  });

  it("keeps one copy of a post the server re-sent, and prefers the server's", () => {
    // THE OPTIMISTIC POST, RE-READ. The client appends its own post immediately
    // and the next page returns the same id from the server. Two copies would
    // show the operator their own message twice, and the body differs here so
    // the assertion can say WHICH copy survived — with identical bodies this
    // fixture could not tell "incoming wins" from "existing wins".
    const merged = mergeChannelPosts({
      existing: [post("p1", 1, "optimistic")],
      incoming: [post("p1", 1, "from the server")],
    });
    expect(merged.map((entry) => entry.body)).toEqual(["from the server"]);
  });

  it("puts an older page BEFORE what the view already had", () => {
    // Paging upward. A concatenation in the other order would render history
    // after the present, which reads as a data bug rather than a merge bug.
    const merged = mergeChannelPosts({
      existing: [post("p3", 3)],
      incoming: [post("p1", 1), post("p2", 2)],
    });
    expect(merged.map((entry) => entry.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("puts a live reply AFTER what the view already had", () => {
    // The mirror, and it needs its own fixture: an implementation that always
    // prepended the incoming page would pass the test above and put every new
    // reply at the top.
    const merged = mergeChannelPosts({
      existing: [post("p1", 1)],
      incoming: [post("p2", 2)],
    });
    expect(merged.map((entry) => entry.id)).toEqual(["p1", "p2"]);
  });

  it("renders the SERVER's order, with lexicographic ids and equal timestamps", () => {
    // THE TEST THAT CATCHES THE BUG THIS FILE SHIPPED. Ten posts, ids that sort
    // lexicographically the wrong way, and every `createdAt` equal — which is
    // ordinary, since it is millisecond resolution and two agents replying at
    // once ties it.
    //
    // The previous version of this test asserted STABILITY: merge two posts both
    // ways and check they agree. The wrong comparator satisfied that too, so it
    // passed while `createdAt` + `id.localeCompare` rendered server order 1..10
    // as 1, 10, 2, 3, … and a reply appeared above the question it answered.
    // Stability is a real property and a weaker one; fidelity is the property.
    const server = Array.from({ length: 10 }, (_, index) => post(`post-${index + 1}`, index + 1));
    const merged = mergeChannelPosts({ existing: [], incoming: server });
    expect(merged.map((entry) => entry.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(merged.map((entry) => entry.id)).toEqual(server.map((entry) => entry.id));
  });

  it("renders the server's order whichever way the pages arrived", () => {
    // Stability, kept as the second property: paging upward and a live reply put
    // the same posts into `existing` and `incoming` in opposite roles, and the
    // rendered order must not depend on which.
    const older = [post("post-1", 1), post("post-2", 2)];
    const newer = [post("post-3", 3)];
    expect(
      mergeChannelPosts({ existing: newer, incoming: older }).map((entry) => entry.sequence),
    ).toEqual([1, 2, 3]);
    expect(
      mergeChannelPosts({ existing: older, incoming: newer }).map((entry) => entry.sequence),
    ).toEqual([1, 2, 3]);
  });

  it("returns the existing posts unchanged when a page comes back empty", () => {
    // The start of history answers with no posts. Losing what the view already
    // had would blank the channel at the moment the reader scrolled to its top.
    const merged = mergeChannelPosts({ existing: [post("p1", 1)], incoming: [] });
    expect(merged.map((entry) => entry.id)).toEqual(["p1"]);
  });
});
