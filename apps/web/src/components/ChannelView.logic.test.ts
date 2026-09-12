import { describe, expect, it } from "vite-plus/test";

import {
  canSendChannelPost,
  resolveChannelComposerState,
  resolveChannelViewState,
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
