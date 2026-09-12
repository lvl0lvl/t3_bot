import { ChannelId, ChannelPostId, ChannelMemberHandle, EnvironmentId } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

/**
 * The post region's behaviour, because nothing imported this component.
 *
 * `TEST-25-01`: `ChannelView.tsx` was reachable from no test at all, so its
 * live-arrival effect could be DELETED with 2481 tests green, and the channel
 * switch leaked one channel's posts into another under the same silence. A
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
const EMPTY_PAGE = { posts: [] as ReadonlyArray<unknown>, nextCursor: null };

const harness = vi.hoisted(() => ({
  /** What the post-page atom answers with, keyed by the request it was built from. */
  pages: new Map<string, { posts: ReadonlyArray<unknown>; nextCursor: string | null }>(),
  /** Every request the region built, in order — the record of what it ASKED. */
  asked: [] as Array<{ channelId: string; direction: string; cursor?: string }>,
  refreshes: 0,
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
    // ONE SHARED EMPTY PAGE, not a fresh object per call. A fresh one gave
    // `arrived` a new identity on every render, so the merge effect — which
    // depends on it by reference — re-ran, called `setPosts`, re-rendered, and
    // looped until the worker died. A real atom memoises its value, so this is
    // faithfulness rather than convenience; see the note at the effect itself.
    const page = harness.pages.get(key) ?? EMPTY_PAGE;
    return { waiting: false, _tag: "Success", value: page };
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
  useChannel: ({ channelId }: { readonly channelId: ChannelId }) =>
    channelId === CHANNEL_A
      ? shell(CHANNEL_A, "alpha", "2026-01-01T00:00:01.000Z")
      : shell(CHANNEL_B, "bravo", "2026-01-01T00:00:02.000Z"),
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

const answer = (
  channelId: ChannelId,
  page: { posts: ReadonlyArray<unknown>; nextCursor: string | null },
  cursor?: string,
) => {
  const request = { channelId, direction: "backward", limit: 50, ...(cursor ? { cursor } : {}) };
  harness.pages.set(JSON.stringify(request), page);
};

const bodies = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((node) => node.type === "article")
    .map((article) => {
      const paragraphs = article.findAll((node) => node.type === "p");
      return String(paragraphs[paragraphs.length - 1]?.children?.[0] ?? "");
    });

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
    harness.pages.clear();
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
    // and `reachedStart` in state, so without a key on it all three survived the
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
    const afterMount = harness.refreshes;
    expect(afterMount).toBeGreaterThan(0);

    // Switching to a channel with a different `latestPostAt` re-runs the effect.
    await act(async () => {
      tree.update(<ChannelView environmentId={ENVIRONMENT} channelId={CHANNEL_B} />);
    });
    expect(harness.refreshes).toBeGreaterThan(afterMount);
  });
});
