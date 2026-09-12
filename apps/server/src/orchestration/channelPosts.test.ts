import { ChannelId, ChannelMemberHandle, ChannelPostId } from "@t3tools/contracts";
import { HUMAN_OPERATOR_MEMBER_ID, refFromOperatorSession } from "@t3tools/contracts";
import type { ChannelMemberRef, OrchestrationChannelPostPageRequest } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProjectionChannelRepositoryLive } from "../persistence/Layers/ProjectionChannels.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ProjectionChannelRepository } from "../persistence/Services/ProjectionChannels.ts";
import { encodeChannelCursor } from "./channelCursor.ts";
import { readChannelPostPage } from "./channelPosts.ts";

/**
 * AGAINST A REAL DATABASE, because every client door stubs this repository.
 *
 * Not a preference. `server.test.ts` binds a stub for the whole projection
 * repository, so no test at either door can see the `LIMIT` or the `ORDER BY`
 * that decide what a reader is sent — and `listChannelsForMember`'s membership
 * filter came to have five surviving mutants for exactly that reason, one of
 * which returned every channel to every client while 198 tests stayed green. The
 * paging arithmetic here has the same exposure.
 */
const NOW = "2026-01-01T00:00:00.000Z";
const PM = ChannelMemberHandle.make("pm");

const layer = it.layer(
  ProjectionChannelRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

/**
 * ONE CHANNEL PER TEST, because `it.layer` builds the database once for the whole
 * block and every test writes into it.
 *
 * Four assertions here failed for that reason before this existed — including the
 * over-fetch boundary, the one the file is for, which asked for the newest three
 * of four posts and was handed the newest three of nine. A fixture an earlier
 * test has rewritten underneath you cannot exercise anything.
 */
const channelFor = (name: string) => ChannelId.make(`channel-${name}`);

/**
 * See `ProjectionChannels.test.ts`: the nominal ref's two real constructors are
 * named for their SOURCE, so a test needing an arbitrary member has to say out
 * loud that it is forging one.
 */
const unsafeRefForTest = (memberKind: "thread" | "human", memberId: string) =>
  ({ memberKind, memberId }) as unknown as ChannelMemberRef;

const channelWith = (channelId: ChannelId, member: ChannelMemberRef) => ({
  channelId,
  name: channelId,
  members: [
    {
      handle: ChannelMemberHandle.make("walt"),
      memberKind: member.memberKind,
      memberId: member.memberId,
    },
  ],
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
});

const post = (channelId: ChannelId, sequence: number) => ({
  postId: ChannelPostId.make(`post-${channelId}-${sequence}`),
  channelId,
  sequence,
  authorHandle: PM,
  body: `post ${sequence}`,
  mentions: [],
  parentPostId: null,
  createdAt: NOW,
});

const request = (
  channelId: ChannelId,
  fields: Partial<OrchestrationChannelPostPageRequest> = {},
): OrchestrationChannelPostPageRequest => ({
  channelId,
  direction: "backward",
  limit: 2,
  ...fields,
});

/** The operator, plus a channel they are in holding posts at sequences 1..count. */
const seed = (channelId: ChannelId, count: number) =>
  Effect.gen(function* () {
    const repo = yield* ProjectionChannelRepository;
    const member = refFromOperatorSession();
    yield* repo.upsertChannel(channelWith(channelId, member));
    for (let sequence = 1; sequence <= count; sequence += 1) {
      yield* repo.insertPost(post(channelId, sequence));
    }
    return member;
  });

const ids = (page: { readonly posts: ReadonlyArray<{ readonly id: string }> }) =>
  page.posts.map((entry) => entry.id);

const expected = (channelId: ChannelId, sequences: ReadonlyArray<number>) =>
  sequences.map((sequence) => `post-${channelId}-${sequence}`);

layer("readChannelPostPage", (it) => {
  it.effect("opens on the NEWEST page, ascending", () =>
    Effect.gen(function* () {
      const channelId = channelFor("newest-page");
      const member = yield* seed(channelId, 5);
      const page = yield* readChannelPostPage({
        request: request(channelId, { limit: 2 }),
        member,
      });

      // The newest two, and OLDEST FIRST within the page. Direction chose the
      // window; it did not choose the order. A page arriving newest-first would
      // render as though time runs backwards, which gets diagnosed as a data bug
      // rather than a rendering one.
      assert.deepStrictEqual(ids(page), expected(channelId, [4, 5]));
      assert.isNotNull(page.nextCursor);
    }),
  );

  it.effect("pages UPWARD from the cursor it was handed", () =>
    Effect.gen(function* () {
      const channelId = channelFor("pages-upward");
      const member = yield* seed(channelId, 5);
      const first = yield* readChannelPostPage({
        request: request(channelId, { limit: 2 }),
        member,
      });
      assert.isNotNull(first.nextCursor);

      const second = yield* readChannelPostPage({
        request: request(channelId, { limit: 2, cursor: first.nextCursor ?? undefined }),
        member,
      });
      assert.deepStrictEqual(ids(second), expected(channelId, [2, 3]));
    }),
  );

  it.effect("drops the over-fetched row from the FRONT going backward", () =>
    Effect.gen(function* () {
      // THE BOUNDARY, and the reason a fixture whose page size equals its row
      // count cannot see it. Backward over-fetches by one and both repository
      // reads return ASCENDING, so the extra row is the OLDEST of the batch.
      // Dropping from the END instead — the `slice(0, limit)` that is correct
      // going forward — returns 1,2,3 here and hides post 4, so the channel opens
      // one post behind and its newest post is unreachable in either direction.
      const channelId = channelFor("backward-boundary");
      const member = yield* seed(channelId, 4);
      const page = yield* readChannelPostPage({
        request: request(channelId, { limit: 3 }),
        member,
      });
      assert.deepStrictEqual(ids(page), expected(channelId, [2, 3, 4]));
    }),
  );

  it.effect("drops the over-fetched row from the END going forward", () =>
    Effect.gen(function* () {
      // The mirror, asserted separately on purpose: an implementation that
      // dropped from the front in BOTH directions passes the backward test above
      // and loses the oldest post here.
      const channelId = channelFor("forward-boundary");
      const member = yield* seed(channelId, 4);
      const page = yield* readChannelPostPage({
        request: request(channelId, { direction: "forward", limit: 3 }),
        member,
      });
      assert.deepStrictEqual(ids(page), expected(channelId, [1, 2, 3]));
    }),
  );

  it.effect("says null rather than 'probably the end' at history's start", () =>
    Effect.gen(function* () {
      // Exactly `limit` rows remain, so the over-fetch comes back short. A cursor
      // here would send the client to fetch an empty page, and an empty page is
      // indistinguishable from the end — the confusion the cursor's channel half
      // exists to remove.
      const channelId = channelFor("history-start");
      const member = yield* seed(channelId, 2);
      const page = yield* readChannelPostPage({
        request: request(channelId, { limit: 2 }),
        member,
      });
      assert.lengthOf(page.posts, 2);
      assert.isNull(page.nextCursor);
    }),
  );

  it.effect("refuses a cursor earned in ANOTHER channel", () =>
    Effect.gen(function* () {
      // NOT an empty page. An empty page is byte for byte what "you are caught
      // up" looks like: this channel would report itself read while holding three
      // unread posts, and nothing in the reply would say otherwise.
      const channelId = channelFor("foreign-cursor");
      const elsewhere = channelFor("foreign-cursor-other");
      const member = yield* seed(channelId, 3);
      yield* seed(elsewhere, 3);

      const outcome = yield* readChannelPostPage({
        request: request(channelId, { cursor: encodeChannelCursor(elsewhere, 2) }),
        member,
      }).pipe(Effect.flip);
      assert.strictEqual(outcome._tag, "ChannelCursorRejected");
    }),
  );

  it.effect("gives a non-member ONE answer for absent and forbidden", () =>
    Effect.gen(function* () {
      const channelId = channelFor("non-member");
      const stranger = unsafeRefForTest("thread", "thread-stranger");
      yield* seed(channelId, 3);

      const absent = yield* readChannelPostPage({
        request: request(channelFor("never-created")),
        member: stranger,
      }).pipe(Effect.flip);
      const forbidden = yield* readChannelPostPage({
        request: request(channelId),
        member: stranger,
      }).pipe(Effect.flip);

      // Two tags here would let a caller enumerate the channels it cannot read by
      // asking for each and reading which refusal came back.
      assert.strictEqual(absent._tag, "ChannelPostsUnreadable");
      assert.strictEqual(forbidden._tag, "ChannelPostsUnreadable");

      // And the second channel really does exist, so `forbidden` is the
      // membership refusal rather than the absence one wearing its clothes.
      const repo = yield* ProjectionChannelRepository;
      const rows = yield* repo.listChannelsForMember(refFromOperatorSession());
      assert.include(
        rows.map((row) => row.channelId),
        channelId,
      );
    }),
  );

  it.effect("checks membership BEFORE it looks at the cursor", () =>
    Effect.gen(function* () {
      // The input that proves the order. A `ChannelCursorRejected` here would
      // tell a non-member both that this channel exists and that their cursor's
      // channel half was the problem — two facts they are not entitled to.
      const channelId = channelFor("order-of-refusals");
      yield* seed(channelId, 3);
      const stranger = unsafeRefForTest("thread", "thread-stranger");

      const outcome = yield* readChannelPostPage({
        request: request(channelId, {
          cursor: encodeChannelCursor(channelFor("somewhere-else"), 2),
        }),
        member: stranger,
      }).pipe(Effect.flip);
      assert.strictEqual(outcome._tag, "ChannelPostsUnreadable");
    }),
  );

  it.effect("reads as the operator's REAL ref, not only the object a test forges", () =>
    Effect.gen(function* () {
      // `refFromOperatorSession()` returns a class instance with a private field;
      // `unsafeRefForTest` returns a plain object. Every other assertion here
      // could pass while production's type was refused somewhere in the path,
      // which is the gap the nominal ref was introduced to close.
      const channelId = channelFor("operator-ref");
      const member = refFromOperatorSession();
      assert.strictEqual(member.memberId, HUMAN_OPERATOR_MEMBER_ID);
      yield* seed(channelId, 1);

      const page = yield* readChannelPostPage({
        request: request(channelId, { limit: 1 }),
        member,
      });
      assert.deepStrictEqual(ids(page), expected(channelId, [1]));
    }),
  );
});
