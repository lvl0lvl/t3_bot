import { describe, expect, it } from "vite-plus/test";

import {
  canSendChannelPost,
  resolveChannelComposerState,
  resolveChannelViewState,
} from "./ChannelView.logic";

describe("resolveChannelViewState", () => {
  it("renders the channel when the client holds it", () => {
    expect(resolveChannelViewState({ channelExists: true, serverSupportsChannels: true })).toBe(
      "ready",
    );
  });

  it("tells a missing channel apart from a server that has none", () => {
    // THE PAIR IS THE TEST. Both inputs produce no channel, and asserting only
    // one of them would pass for a view that showed one message for both — which
    // is the version that tells an operator to ask for an invite to a server
    // that cannot have channels at all.
    expect(resolveChannelViewState({ channelExists: false, serverSupportsChannels: true })).toBe(
      "unavailable",
    );
    expect(resolveChannelViewState({ channelExists: false, serverSupportsChannels: false })).toBe(
      "unsupported",
    );
  });

  it("renders the channel it holds even on a server that reports no support", () => {
    // Not a contrived combination: the snapshot's `channels` field is what says
    // "supported", and a live `channel-upserted` can arrive against a snapshot
    // that had no field. Holding the channel is the stronger fact, and a view
    // that checked support FIRST would blank a channel it could render.
    expect(resolveChannelViewState({ channelExists: true, serverSupportsChannels: false })).toBe(
      "ready",
    );
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
