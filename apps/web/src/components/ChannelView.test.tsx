import { ChannelId, ChannelPostId, ChannelMemberHandle, EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

/**
 * The post region's behaviour, because nothing imported this component.
 *
 * `TEST-25-01`: `ChannelView.tsx` was reachable from no test at all, so its
 * live-arrival effect could be DELETED without a single test going red, and the
 * channel switch leaked one channel's posts into another under the same silence. A
 * component holding four pieces of state and three effects had the same coverage
 * as a component that did not exist.
 *
 * WHAT THIS DRIVES, and what it deliberately does not. It mounts the real
 * component and asserts what a reader would see: which posts are on screen,
 * whether the pager is offered, and what the region asked the server for. It does
 * NOT assert props or attributes, and it does not check that a callback is wired
 * — the repository forbids both, and both would pass against the bugs these
 * tests exist to catch.
 *
 * The mocking is at `@effect/atom-react`, following `state/usage.test.tsx`: the
 * region's inputs are two atom hooks, so stubbing them is the seam. Everything
 * below them — the merge, the cursor handling, the state resets — is the real
 * code.
 */
/**
 * ONE SHARED RESULT for a request nothing registered, and its `value` is one
 * shared object.
 *
 * A fresh page object per call gave `arrived` a new identity every render, re-ran
 * the merge effect, called `setPosts`, and looped until the worker died of an
 * out-of-memory whose report said only "Worker exited unexpectedly". A real atom
 * memoises its value, so this is faithfulness rather than convenience.
 */
const EMPTY_RESULT = {
  waiting: false,
  _tag: "Success",
  value: { posts: [] as ReadonlyArray<unknown>, nextCursor: null },
};

const harness = vi.hoisted(() => ({
  /**
   * What the post-page atom answers with, keyed by the request it was built from.
   *
   * A RESULT rather than a page, because "no page has arrived yet" is a result
   * and not a page: `AsyncResult.Initial` carries `waiting` and no value at all,
   * and `AsyncResult.value` of it is `none`. That is the state the region is in
   * on every open until the first read lands, and a mock that could only answer
   * `Success` could not put the pager's gate under it.
   */
  results: new Map<string, unknown>(),
  /** Every request the region built, in order — the record of what it ASKED. */
  asked: [] as Array<{ channelId: string; direction: string; cursor?: string }>,
  refreshes: 0,
  /**
   * Channel A's `latestPostAt`, MUTABLE.
   *
   * The live-arrival effect fires on a CHANGE to this value, and the only fixture that
   * distinguishes that from firing on mount is one where the value changes under a
   * region that is already mounted. Driving it by switching channels cannot: the region
   * is keyed on the channel id, so a switch is a remount and both implementations agree.
   */
  latestPostAtForA: "2026-01-01T00:00:01.000Z" as string | null,
  /** One refresh callback per atom, because the real hook is stable per atom. */
  refreshers: new WeakMap<object, () => void>(),
}));

vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: (atom: unknown) => {
    const request = atom as { readonly __request?: (typeof harness.asked)[number] };
    if (request.__request === undefined) {
      return { waiting: false, _tag: "Success", value: undefined };
    }
    harness.asked.push(request.__request);
    // A RENDER-LOOP TRIPWIRE, so a loop is a stack trace instead of an
    // out-of-memory kill. The first version of this file OOM'd the worker and the
    // report said only "Worker exited unexpectedly", which names the symptom and
    // not the subject — the same class of unhelpful instrument this repository
    // keeps running into.
    if (harness.asked.length > 200) {
      throw new Error(
        `render loop: the region asked ${harness.asked.length} times for ` +
          JSON.stringify(request.__request),
      );
    }
    const key = JSON.stringify(request.__request);
    return harness.results.get(key) ?? EMPTY_RESULT;
  },
  // Stable per atom, as the real hook is. An unstable one turns the refresh
  // effect into an infinite loop, which is how the OOM above happened.
  useAtomRefresh: (atom: unknown) => {
    const key = atom as object;
    const existing = harness.refreshers.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const made = () => {
      harness.refreshes += 1;
    };
    harness.refreshers.set(key, made);
    return made;
  },
}));

/**
 * The atom family, replaced by one that carries the request — and MEMOISED by
 * that request, because a real family is.
 *
 * My first version returned a fresh object per call, and the whole suite died of
 * an out-of-memory in the worker: the component builds its atom inline each
 * render, so a non-memoising family gave `useAtomRefresh` a new identity every
 * render, the refresh effect's dependency changed every render, and it looped.
 *
 * That was a mock artifact rather than a defect — `Atom.family` keys on the
 * input — but it is worth recording, because it is the shape the hazard would
 * take if the family's key ever stopped covering the request: this component's
 * refresh effect depends on `refresh` being stable.
 */
vi.mock("../state/orchestration", () => {
  const atoms = new Map<string, { readonly __request: unknown }>();
  return {
    orchestrationEnvironment: {
      channelPosts: (input: { readonly input: (typeof harness.asked)[number] }) => {
        const key = JSON.stringify(input.input);
        const existing = atoms.get(key);
        if (existing !== undefined) {
          return existing;
        }
        const made = { __request: input.input };
        atoms.set(key, made);
        return made;
      },
    },
  };
});

vi.mock("../state/threads", () => ({
  channelEnvironment: { post: {} },
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: () => [() => Promise.resolve(), { waiting: false }],
}));
vi.mock("../hooks/useSettings", () => ({
  useEnvironmentSettings: () => ({ timestampFormat: "24h" }),
}));

const CHANNEL_A = ChannelId.make("channel-a");
const CHANNEL_B = ChannelId.make("channel-b");
/** A channel nobody has posted to: `latestPostAt` is null, which the header reads. */
const CHANNEL_EMPTY = ChannelId.make("channel-empty");
const ENVIRONMENT = EnvironmentId.make("env-1");

const shell = (id: ChannelId, name: string, latestPostAt: string | null) => ({
  id,
  environmentId: ENVIRONMENT,
  name,
  archivedAt: null,
  latestPostAt,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

vi.mock("../state/entities", () => ({
  useChannel: ({ channelId }: { readonly channelId: ChannelId }) => {
    if (channelId === CHANNEL_EMPTY) {
      return shell(CHANNEL_EMPTY, "quiet", null);
    }
    return channelId === CHANNEL_A
      ? shell(CHANNEL_A, "alpha", harness.latestPostAtForA)
      : shell(CHANNEL_B, "bravo", "2026-01-01T00:00:02.000Z");
  },
  useChannelSupport: () => "supported",
}));

const post = (sequence: number, id: string, body = id) => ({
  // THE ID IS EXPLICIT, and that is not fussiness. I first derived it from the
  // body, which `ChannelPostId`'s brand refused because a body can contain
  // spaces; I then derived it from the sequence, which made two channels' posts
  // share `post-1` — so `mergeChannelPosts` de-duplicated the leak away and the
  // channel-switch test PASSED WITHOUT THE KEY. Measured: the `key-removed`
  // mutant survived. Two posts from two channels have to be two posts.
  id: ChannelPostId.make(id),
  channelId: CHANNEL_A,
  sequence,
  authorHandle: ChannelMemberHandle.make("pm"),
  body,
  mentions: [],
  parentPostId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

// `limit: 50` IS `CHANNEL_POST_PAGE_SIZE`, repeated rather than imported because
// importing from `./ChannelView` here would load it during the hoisted import
// phase, ahead of the fixtures the `../state/entities` mock closes over. The
// repetition is pinned: "asks for the NEWEST page on open" asserts the number the
// region actually sent, so changing the constant reds that test by name instead of
// silently missing every key in this map.
const requestKey = (channelId: ChannelId, cursor?: string) =>
  JSON.stringify({ channelId, direction: "backward", limit: 50, ...(cursor ? { cursor } : {}) });

const answer = (
  channelId: ChannelId,
  page: { posts: ReadonlyArray<unknown>; nextCursor: string | null },
  cursor?: string,
) => {
  harness.results.set(requestKey(channelId, cursor), {
    waiting: false,
    _tag: "Success",
    value: page,
  });
};

/**
 * A read that FAILED, holding no previous success.
 *
 * `AsyncResult.value` of a Failure is `Option.map(previousSuccess, ...)`, so an absent
 * previous success is what makes `arrived` undefined — which is exactly the state in
 * which the old pager offered to fetch a page it had no cursor for.
 */
const answerFailure = (channelId: ChannelId, cursor?: string) => {
  harness.results.set(requestKey(channelId, cursor), {
    waiting: false,
    _tag: "Failure",
    previousSuccess: Option.none(),
  });
};

/** The read before it resolves: waiting, and holding no page at all. */
const answerNothingYet = (channelId: ChannelId, cursor?: string) => {
  harness.results.set(requestKey(channelId, cursor), { waiting: true, _tag: "Initial" });
};

const bodies = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((node) => node.type === "article")
    .map((article) => {
      const paragraphs = article.findAll((node) => node.type === "p");
      return String(paragraphs[paragraphs.length - 1]?.children?.[0] ?? "");
    });

/**
 * How many times a phrase appears in what was rendered.
 *
 * Over the rendered tree rather than over a single node, because the defect this
 * measures is two nodes in different components saying the same thing — which
 * every assertion scoped to one component passes.
 */
const occurrences = (tree: ReactTestRenderer, phrase: string) =>
  JSON.stringify(tree.toJSON()).split(phrase).length - 1;

const buttonLabels = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((node) => node.type === "button")
    .flatMap((button) => button.findAll((node) => typeof node.children?.[0] === "string"))
    .map((node) => String(node.children[0]));

describe("ChannelPostRegion", () => {
  const mount = async (channelId: ChannelId) => {
    const { ChannelView } = await import("./ChannelView");
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<ChannelView environmentId={ENVIRONMENT} channelId={channelId} />);
    });
    return tree;
  };

  const reset = () => {
    harness.latestPostAtForA = "2026-01-01T00:00:01.000Z";
    harness.results.clear();
    harness.asked.length = 0;
    harness.refreshes = 0;
  };

  it("renders the page the server returned, in the server's order", async () => {
    reset();
    answer(CHANNEL_A, {
      posts: [post(1, "p-first", "first"), post(2, "p-second", "second")],
      nextCursor: null,
    });
    const tree = await mount(CHANNEL_A);
    expect(bodies(tree)).toEqual(["first", "second"]);
  });

  it("asks for the NEWEST page on open, with no cursor", async () => {
    reset();
    answer(CHANNEL_A, { posts: [post(1, "p-only", "only")], nextCursor: null });
    await mount(CHANNEL_A);
    // `direction: "backward"` and no cursor IS "the newest page". A region that
    // opened forward would show the beginning of history, which is the wrong end
    // of a chat and the thing the PM's ruling on #18's read was about.
    expect(harness.asked[0]).toEqual({ channelId: CHANNEL_A, direction: "backward", limit: 50 });
    expect(harness.asked[0]).not.toHaveProperty("cursor");
  });

  it("offers the pager only when the server said there is more", async () => {
    reset();
    answer(CHANNEL_A, { posts: [post(2, "p-newest", "newest")], nextCursor: "channel-a:1" });
    const withMore = await mount(CHANNEL_A);
    expect(buttonLabels(withMore)).toContain("Earlier posts");

    reset();
    answer(CHANNEL_A, { posts: [post(1, "p-all", "all there is")], nextCursor: null });
    const atStart = await mount(CHANNEL_A);
    // `nextCursor: null` means the beginning of history. Offering the control
    // there sends a reader to fetch an empty page, which is indistinguishable
    // from the end — the confusion the cursor's channel half exists to remove.
    expect(buttonLabels(atStart)).not.toContain("Earlier posts");
  });

  it("does NOT carry one channel's posts into another", async () => {
    // BUG-25-01, and the fixture is the SPA navigation that produced it: the same
    // element type at the same position with no key, which is what the router
    // renders when only `$channelId` changes. The region holds `posts`, `cursor`
    // and `moreAbove` in state, so without a key on it all three survived the
    // switch — channel B rendered channel A's history and asked the server with
    // channel A's cursor, which it refuses.
    reset();
    answer(CHANNEL_A, { posts: [post(1, "p-alpha", "ALPHA")], nextCursor: null });
    answer(CHANNEL_B, { posts: [post(2, "p-bravo", "BRAVO")], nextCursor: null });

    const { ChannelView } = await import("./ChannelView");
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<ChannelView environmentId={ENVIRONMENT} channelId={CHANNEL_A} />);
    });
    expect(bodies(tree)).toEqual(["ALPHA"]);

    await act(async () => {
      tree.update(<ChannelView environmentId={ENVIRONMENT} channelId={CHANNEL_B} />);
    });
    expect(bodies(tree)).toEqual(["BRAVO"]);
  });

  it("asks the server again when the channel reports a newer post", async () => {
    // The live-arrival path, which was deletable with everything green. There is
    // no per-post event — the shell coalescer keeps only the newest event per
    // aggregate per 50ms window — so a new post reaches the client as a changed
    // `latestPostAt` and the region has to re-read. Counting refreshes is the
    // only observable that distinguishes "it re-reads" from "it does not".
    reset();
    answer(CHANNEL_A, { posts: [post(1, "p-before", "before")], nextCursor: null });
    const { ChannelView } = await import("./ChannelView");
    const tree = await mount(CHANNEL_A);

    // NO REFRESH ON MOUNT (`BUG-25-03`). The atom is already fetching — every query
    // here is `Atom.swr({ revalidateOnMount: true })` — and a manual refresh is
    // forceful and always forwarded, so this effect firing on the first commit ran the
    // open TWICE and pulled up to two pages over the socket. This assertion is the
    // inverse of the one it replaces, which asserted the second read as though it were
    // the feature.
    expect(harness.refreshes).toBe(0);

    // A NEW POST ON THE SAME CHANNEL, which is the only fixture that separates "fires on
    // a change" from "fires on mount". The old version switched channels, and the region
    // is keyed on the channel id — so that was a remount, where both implementations
    // refresh exactly once and neither can be told from the other.
    harness.latestPostAtForA = "2026-01-01T00:05:00.000Z";
    await act(async () => {
      tree.update(<ChannelView environmentId={ENVIRONMENT} channelId={CHANNEL_A} />);
    });
    expect(harness.refreshes).toBe(1);

    // AND NOT AGAIN for the same value. A re-render caused by anything else must not
    // re-read a post the region has already asked about.
    await act(async () => {
      tree.update(<ChannelView environmentId={ENVIRONMENT} channelId={CHANNEL_A} />);
    });
    expect(harness.refreshes).toBe(1);
  });

  it("says a page failed, and the control retries it", async () => {
    // `BUG-25-02`. The failure branch is gated on `posts.length === 0`, so a page that
    // failed AFTER one had landed rendered the previous screen unchanged: no error, and
    // the pager back to "Earlier posts" as though ready. Pressing it did nothing —
    // `arrived` is undefined over a Failure — and live arrival had already stopped,
    // because `cursor` is no longer undefined. A channel that stops mid-history with a
    // control that lies about being able to continue, and no way back without a reload.
    reset();
    answer(CHANNEL_A, { posts: [post(2, "p-newest", "NEWEST")], nextCursor: "channel-a:1" });
    answerFailure(CHANNEL_A, "channel-a:1");
    const tree = await mount(CHANNEL_A);
    expect(buttonLabels(tree)).toContain("Earlier posts");

    const pager = tree.root.findAll((node) => node.type === "button")[0];
    await act(async () => {
      pager?.props.onClick?.();
    });

    // The posts already on screen stay — the reader does not lose their place.
    expect(bodies(tree)).toEqual(["NEWEST"]);
    // AND THE CONTROL SAYS SO. A label reading "Earlier posts" here is the stale label
    // this repository's taste section names, and it is also an offer it cannot honour.
    expect(buttonLabels(tree)).toContain("Earlier posts didn’t load. Try again");
    expect(buttonLabels(tree)).not.toContain("Earlier posts");

    // Pressing it RE-ISSUES the same read rather than advancing or resetting the cursor:
    // reverting to the newest page would silently undo what the reader asked for.
    const before = harness.refreshes;
    const retry = tree.root.findAll((node) => node.type === "button")[0];
    await act(async () => {
      retry?.props.onClick?.();
    });
    expect(harness.refreshes).toBe(before + 1);
  });
  it("does not offer the pager before any page has arrived", async () => {
    // THE FOURTH STATE, reachable on every single open. The read is `Initial`
    // with no value until the first page lands, so `arrived` is undefined — and a
    // `reachedStart` boolean starting `false` let the pager render anyway, over an
    // empty pane, offering to fetch older posts while the region held no cursor to
    // fetch them with. Clicking it did nothing.
    reset();
    answerNothingYet(CHANNEL_A);
    const tree = await mount(CHANNEL_A);
    expect(bodies(tree)).toEqual([]);
    // NEITHER LABEL. The control is absent, not disabled: a disabled control still
    // tells a reader the action exists and is merely busy, and nothing here is
    // busy on the reader's behalf.
    expect(buttonLabels(tree)).not.toContain("Earlier posts");
    expect(buttonLabels(tree)).not.toContain("Loading earlier posts…");
  });

  it("offers the pager again when a later page says there is more", async () => {
    // NOT A LATCH, and this is the input that distinguishes the two: a channel
    // whose whole history fits one page answers `nextCursor: null`, so the pager
    // is correctly hidden. When the next post arrives the region re-reads under
    // the same absent cursor, and that page is full and carries a cursor again. A
    // latched `reachedStart` stayed true and hid the pager for the rest of the
    // session; every fixture that only grows one page's contents agrees with both
    // implementations, which is why the earlier tests could not see this.
    reset();
    answer(CHANNEL_A, { posts: [post(1, "p-one", "one")], nextCursor: null });
    const { ChannelView } = await import("./ChannelView");
    const tree = await mount(CHANNEL_A);
    expect(buttonLabels(tree)).not.toContain("Earlier posts");

    answer(CHANNEL_A, {
      posts: [post(1, "p-one", "one"), post(2, "p-two", "two")],
      nextCursor: "channel-a:1",
    });
    await act(async () => {
      tree.update(<ChannelView environmentId={ENVIRONMENT} channelId={CHANNEL_A} />);
    });
    expect(bodies(tree)).toEqual(["one", "two"]);
    expect(buttonLabels(tree)).toContain("Earlier posts");
  });
  it("says 'No posts yet' once, not in the header as well", async () => {
    // MEASURED IN A BROWSER AS TWO NODES in all four viewport/theme combinations:
    // the header's timestamp slot said "No posts yet" and the pane 60px below said
    // "No posts yet. Say something to start the channel." One fact, rendered
    // twice, reads as a repeated element rather than as two things worth knowing.
    //
    // Both assertions, because they distinguish three implementations: the header
    // keeping the phrase gives 2, the PANE losing its sentence gives 1 and 0, and
    // only the header's slot being empty gives 1 and 1.
    reset();
    answer(CHANNEL_EMPTY, { posts: [], nextCursor: null });
    const tree = await mount(CHANNEL_EMPTY);
    expect(occurrences(tree, "No posts yet")).toBe(1);
    expect(occurrences(tree, "No posts yet. Say something to start the channel.")).toBe(1);
  });
  it("says the history could not be read, and offers a retry", async () => {
    // The FIRST read failing, which is a different state from a later page failing and
    // was covered by nothing. `HIST-25-03`: the copy here came from #20, when the read
    // genuinely did not exist, and told the operator their server was too old — now one
    // of several ways to reach this, and the only one retrying cannot fix. A store
    // failure, a dropped socket and a refused cursor all land here.
    reset();
    answerFailure(CHANNEL_A);
    const tree = await mount(CHANNEL_A);

    expect(bodies(tree)).toEqual([]);
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain("could not be read");
    // NOT the old advice as the only explanation. A reader whose socket dropped should
    // not be sent to update a server.
    expect(rendered).not.toContain("reading the history needs a newer server");

    // AND A WAY FORWARD, which this state did not have. `refresh()` re-issues the read
    // that failed.
    expect(buttonLabels(tree)).toContain("Try again");
    const before = harness.refreshes;
    const retry = tree.root
      .findAll((node) => node.type === "button")
      .find((button) => button.findAll((node) => node.children?.[0] === "Try again").length > 0);
    await act(async () => {
      retry?.props.onClick?.();
    });
    expect(harness.refreshes).toBe(before + 1);
  });
});
