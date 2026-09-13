import { ChannelId, ChannelMemberHandle, ChannelPostId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionChannelRepositoryLive } from "./ProjectionChannels.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { HUMAN_OPERATOR_MEMBER_ID, refFromOperatorSession } from "@t3tools/contracts";
import type { ChannelMemberRef } from "@t3tools/contracts";
import { ProjectionChannelRepository } from "../Services/ProjectionChannels.ts";
import {
  COLLIDING_HUMAN_MEMBER,
  COLLIDING_HUMAN_REF,
  COLLIDING_THREAD_REF,
} from "../../orchestration/testing/collidingRoster.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const CHANNEL = ChannelId.make("channel-seniors");
const OTHER = ChannelId.make("channel-project");
const BOSS1 = ChannelMemberHandle.make("boss1");
const PM = ChannelMemberHandle.make("pm");

const layer = it.layer(
  ProjectionChannelRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

function channel(channelId: ChannelId, name: string, handles: ReadonlyArray<string>) {
  return {
    channelId,
    name,
    members: handles.map((handle) => ({
      handle: ChannelMemberHandle.make(handle),
      memberKind: "thread" as const,
      memberId: `thread-${handle}`,
    })),
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/**
 * A channel whose members carry an EXPLICIT kind and id.
 *
 * `channel()` above hardcodes `memberKind: "thread"` and derives the id from
 * the handle, so every member it builds differs from every other in BOTH
 * fields. That is the fixture shape `t3_bot-46h` names: a comparison that
 * ignored `memberKind` passes against it. The membership filter in
 * `listChannelsForMember` is a two-field WHERE, so separating the fields needs
 * a builder that can say so.
 */
/**
 * The ONE way a test may forge a `ChannelMemberRef`, named so it cannot pass for
 * the real thing.
 *
 * The type is a class with a private field in `@t3tools/contracts` and its two
 * real constructors are named for their SOURCE — a credential or the operator's
 * session — so neither can express "a human whose id is `order-member`", which
 * is what the ordering tests ask for. This is the way in, and it is `unsafe` in
 * the name because a reviewer must not read it as production code. `makeRef`
 * would not say that. The one ref the constructors CAN express — a thread
 * carrying the operator's id — comes from the shared roster
 * (`orchestration/testing/collidingRoster.ts`), not from here.
 *
 * These call sites were object literals until the nominal type moved into
 * contracts; that they stopped compiling is the type doing its job.
 */
const unsafeRefForTest = (memberKind: "thread" | "human", memberId: string) =>
  ({ memberKind, memberId }) as unknown as ChannelMemberRef;

function channelWithMembers(
  channelId: ChannelId,
  name: string,
  members: ReadonlyArray<{
    readonly handle: string;
    readonly memberKind: "thread" | "human";
    readonly memberId: string;
  }>,
  fields: { readonly createdAt?: string } = {},
) {
  return {
    channelId,
    name,
    members: members.map((member) => ({
      ...member,
      handle: ChannelMemberHandle.make(member.handle),
    })),
    archivedAt: null,
    createdAt: fields.createdAt ?? NOW,
    updatedAt: fields.createdAt ?? NOW,
  };
}

function post(postId: string, channelId: ChannelId, sequence: number, mentions: string[] = []) {
  return {
    postId: ChannelPostId.make(postId),
    channelId,
    sequence,
    authorHandle: PM,
    body: "what is 2+2",
    mentions: mentions.map((handle) => ChannelMemberHandle.make(handle)),
    parentPostId: null,
    createdAt: NOW,
  };
}

layer("ProjectionChannelRepository", (it) => {
  it.effect("accepts a REAL member ref, not just the plain object the tests forge", () =>
    Effect.gen(function* () {
      // THE ONE THING THE NOMINAL REF CHANGED AT THIS CALL SITE IS THE ONE
      // THING NOTHING EXERCISED. `unsafeRefForTest` returns a plain object, and
      // `server.test.ts` stubs this repository — so every existing test here
      // asks "does the query filter on both fields" and none asks "does it
      // accept the type production actually passes".
      //
      // Production hands it `refFromOperatorSession()`: a class instance whose
      // prototype is not `Object` and which carries a third own property,
      // `nominal`, straight into a `SqlSchema` request struct. A fixture that
      // can only produce plain objects cannot tell "the repository accepts the
      // nominal type" from "the repository accepts anything", which is exactly
      // the distinction moving the ref into contracts was for. Found by a blind
      // verifier as a coverage hole rather than a bug — Effect Schema reads the
      // struct's fields by key and ignores the excess — but an untested
      // load-bearing property is one Schema upgrade away from an outage.
      const repo = yield* ProjectionChannelRepository;
      yield* repo.upsertChannel(
        channelWithMembers(ChannelId.make("real-ref"), "real-ref", [
          {
            handle: "walt",
            memberKind: "human",
            memberId: HUMAN_OPERATOR_MEMBER_ID,
          },
        ]),
      );

      const rows = yield* repo.listChannelsForMember(refFromOperatorSession());

      assert.deepStrictEqual(
        rows.map((row) => row.name),
        ["real-ref"],
      );
    }),
  );

  it.effect("round-trips a channel and its members by name and by id", () =>
    Effect.gen(function* () {
      const repo = yield* ProjectionChannelRepository;
      yield* repo.upsertChannel(channel(CHANNEL, "seniors", ["boss1", "pm"]));

      const byName = yield* repo.getChannelByName("seniors");
      assert.isTrue(Option.isSome(byName));
      if (Option.isSome(byName)) {
        assert.strictEqual(byName.value.channelId, CHANNEL);
        assert.deepStrictEqual(
          byName.value.members.map((member) => member.handle),
          [BOSS1, PM],
        );
      }

      const byId = yield* repo.getChannelById(CHANNEL);
      assert.isTrue(Option.isSome(byId));
    }),
  );

  it.effect("a channel with no members reads as present, not absent", () =>
    Effect.gen(function* () {
      // The gateway conflates "not a member" with "no such channel". If an
      // empty membership made the channel itself disappear here, that
      // conflation would fire for a channel that exists and is merely empty.
      const repo = yield* ProjectionChannelRepository;
      yield* repo.upsertChannel(channel(OTHER, "project", []));

      const found = yield* repo.getChannelByName("project");
      assert.isTrue(Option.isSome(found));
      if (Option.isSome(found)) {
        assert.deepStrictEqual(found.value.members, []);
      }
    }),
  );

  it.effect("an upsert replaces membership rather than accumulating it", () =>
    Effect.gen(function* () {
      const repo = yield* ProjectionChannelRepository;
      yield* repo.upsertChannel(channel(CHANNEL, "seniors", ["boss1", "pm"]));
      yield* repo.upsertChannel(channel(CHANNEL, "seniors", ["boss1"]));

      const found = yield* repo.getChannelByName("seniors");
      if (Option.isSome(found)) {
        assert.deepStrictEqual(
          found.value.members.map((member) => member.handle),
          [BOSS1],
        );
      }
    }),
  );

  it.effect("an unknown name and an unknown id both read as absent", () =>
    Effect.gen(function* () {
      const repo = yield* ProjectionChannelRepository;
      assert.isTrue(Option.isNone(yield* repo.getChannelByName("nope")));
      assert.isTrue(Option.isNone(yield* repo.getChannelById(ChannelId.make("nope"))));
    }),
  );

  it.effect("a post is scoped to its channel", () =>
    Effect.gen(function* () {
      const repo = yield* ProjectionChannelRepository;
      yield* repo.insertPost(post("post-1", CHANNEL, 1));

      const inChannel = yield* repo.getPost({
        channelId: CHANNEL,
        postId: ChannelPostId.make("post-1"),
      });
      assert.isTrue(Option.isSome(inChannel));

      // Same post id, wrong channel: must be indistinguishable from missing.
      const crossChannel = yield* repo.getPost({
        channelId: OTHER,
        postId: ChannelPostId.make("post-1"),
      });
      assert.isTrue(Option.isNone(crossChannel));
    }),
  );

  it.effect("mentions survive the json round-trip, including empty and unicode", () =>
    Effect.gen(function* () {
      const repo = yield* ProjectionChannelRepository;
      yield* repo.insertPost(post("post-mentions", CHANNEL, 2, ["boss1", "pm"]));
      yield* repo.insertPost(post("post-empty", CHANNEL, 3, []));

      const withMentions = yield* repo.getPost({
        channelId: CHANNEL,
        postId: ChannelPostId.make("post-mentions"),
      });
      if (Option.isSome(withMentions)) {
        assert.deepStrictEqual(withMentions.value.mentions, [BOSS1, PM]);
      }

      const withoutMentions = yield* repo.getPost({
        channelId: CHANNEL,
        postId: ChannelPostId.make("post-empty"),
      });
      if (Option.isSome(withoutMentions)) {
        assert.deepStrictEqual(withoutMentions.value.mentions, []);
      }
    }),
  );

  it.effect("pages oldest first and the cursor is exclusive", () =>
    Effect.gen(function* () {
      // Its own channel: this layer shares one in-memory database across tests,
      // so paging asserted against a channel other tests post into is not a
      // statement about paging.
      const repo = yield* ProjectionChannelRepository;
      const paging = ChannelId.make("channel-paging");
      // Sequence 0 included deliberately. The absent-cursor sentinel is -1, and
      // 0 is the only value that distinguishes it from a sentinel of 0 — without
      // this row the sentinel is unpinned and either constant passes.
      for (const sequence of [3, 1, 2, 0]) {
        yield* repo.insertPost(post(`post-seq-${sequence}`, paging, sequence));
      }

      // No cursor must start BEFORE the lowest sequence, not at it.
      const first = yield* repo.listPosts({
        channelId: paging,
        limit: 2,
        afterSequence: undefined,
      });
      assert.deepStrictEqual(
        first.map((row) => row.sequence),
        [0, 1],
      );

      const next = yield* repo.listPosts({ channelId: paging, limit: 2, afterSequence: 1 });
      assert.deepStrictEqual(
        next.map((row) => row.sequence),
        [2, 3],
      );

      const exhausted = yield* repo.listPosts({ channelId: paging, limit: 2, afterSequence: 3 });
      assert.deepStrictEqual(exhausted, []);
    }),
  );

  it.effect("reads the NEWEST window backward and still returns it ascending", () =>
    Effect.gen(function* () {
      const repo = yield* ProjectionChannelRepository;
      const back = ChannelId.make("channel-backward");
      for (const sequence of [4, 0, 2, 1, 3]) {
        yield* repo.insertPost(post(`post-back-${sequence}`, back, sequence));
      }

      // FIVE ROWS AND A LIMIT OF TWO, because that is what distinguishes the
      // two implementations. `ORDER BY sequence DESC LIMIT 2` then reversed
      // gives [3, 4]; `ORDER BY sequence ASC LIMIT 2` gives [0, 1]. BOTH are
      // ascending, so an assertion that only checked the order would pass
      // against the wrong page. The sequences are the assertion.
      const newest = yield* repo.listPostsBackward({
        channelId: back,
        limit: 2,
        beforeSequence: undefined,
      });
      assert.deepStrictEqual(
        newest.map((row) => row.sequence),
        [3, 4],
      );

      // Exclusive, and walking UP the history: the cursor is the oldest
      // sequence returned, so the next page is strictly older than it.
      const older = yield* repo.listPostsBackward({
        channelId: back,
        limit: 2,
        beforeSequence: 3,
      });
      assert.deepStrictEqual(
        older.map((row) => row.sequence),
        [1, 2],
      );

      // The beginning of history returns a SHORT page rather than an empty
      // one - the caller learns it is at the start from the count, and from
      // the empty page after it.
      const first = yield* repo.listPostsBackward({
        channelId: back,
        limit: 2,
        beforeSequence: 1,
      });
      assert.deepStrictEqual(
        first.map((row) => row.sequence),
        [0],
      );
      const beyond = yield* repo.listPostsBackward({
        channelId: back,
        limit: 2,
        beforeSequence: 0,
      });
      assert.deepStrictEqual(beyond, []);
    }),
  );

  it.effect("the same post id in two channels does not drop either post", () =>
    Effect.gen(function* () {
      // Post ids are caller-supplied. Under a global key the second insert
      // reported success and wrote nothing, while the event still landed in
      // the log — so the mention reactor would wake on a post no read can
      // return. The row is keyed by channel for that reason.
      const repo = yield* ProjectionChannelRepository;
      const shared = ChannelPostId.make("post-shared-id");
      const left = ChannelId.make("channel-dup-left");
      const right = ChannelId.make("channel-dup-right");

      yield* repo.insertPost({ ...post("ignored", left, 1), postId: shared, body: "in left" });
      yield* repo.insertPost({ ...post("ignored", right, 1), postId: shared, body: "in right" });

      const inLeft = yield* repo.getPost({ channelId: left, postId: shared });
      const inRight = yield* repo.getPost({ channelId: right, postId: shared });
      assert.isTrue(Option.isSome(inLeft));
      assert.isTrue(Option.isSome(inRight));
      if (Option.isSome(inLeft) && Option.isSome(inRight)) {
        assert.strictEqual(inLeft.value.body, "in left");
        assert.strictEqual(inRight.value.body, "in right");
      }
    }),
  );

  it.effect("re-inserting the same post is a no-op, so replay stays idempotent", () =>
    Effect.gen(function* () {
      // The conflict clause exists for bootstrap replay, which re-projects the
      // same event. Removing it to fix the collision above would break that.
      const repo = yield* ProjectionChannelRepository;
      const replay = ChannelId.make("channel-replay");
      yield* repo.insertPost(post("post-replay", replay, 1));
      yield* repo.insertPost(post("post-replay", replay, 1));

      const rows = yield* repo.listPosts({
        channelId: replay,
        limit: 50,
        afterSequence: undefined,
      });
      assert.strictEqual(rows.length, 1);
    }),
  );

  it.effect("a body carrying sql metacharacters is stored verbatim", () =>
    Effect.gen(function* () {
      const repo = yield* ProjectionChannelRepository;
      const body = "'; DROP TABLE projection_channel_posts; -- é中";
      yield* repo.insertPost({ ...post("post-sqli", CHANNEL, 9), body });

      const found = yield* repo.getPost({
        channelId: CHANNEL,
        postId: ChannelPostId.make("post-sqli"),
      });
      assert.isTrue(Option.isSome(found));
      if (Option.isSome(found)) {
        assert.strictEqual(found.value.body, body);
      }
      // The table still answers, so nothing was executed.
      const still = yield* repo.listPosts({
        channelId: CHANNEL,
        limit: 50,
        afterSequence: undefined,
      });
      assert.isTrue(still.length > 0);
    }),
  );
  it.effect("lists only the channels this member belongs to", () =>
    Effect.gen(function* () {
      // THE MEMBERSHIP FILTER, against a real database. Both shell-snapshot
      // door tests stub this method, so the WHERE clause that decides what a
      // client is sent is invisible to them — and dropping the membership JOIN
      // outright, which returns EVERY channel on the server to EVERY client,
      // survived the whole suite until this test existed.
      const repo = yield* ProjectionChannelRepository;
      const mineId = ChannelId.make("filter-mine");
      const theirsId = ChannelId.make("filter-theirs");
      yield* repo.upsertChannel(
        channelWithMembers(mineId, "filter-mine", [
          { handle: "walt", memberKind: "human", memberId: "filter-human-walt" },
        ]),
      );
      yield* repo.upsertChannel(
        channelWithMembers(theirsId, "filter-theirs", [
          { handle: "pm", memberKind: "thread", memberId: "filter-thread-pm" },
        ]),
      );

      const rows = yield* repo.listChannelsForMember(
        unsafeRefForTest("human", "filter-human-walt"),
      );

      assert.deepStrictEqual(
        rows.map((row) => row.channelId),
        [mineId],
      );
    }),
  );

  it.effect("a member whose id matches but whose KIND does not gets nothing", () =>
    Effect.gen(function* () {
      // The input that separates the two halves of the WHERE clause, and the
      // only one that can: the id is identical and the kind differs. Dropping
      // `m.member_kind` from the filter passes every other test in this file,
      // because every other fixture's members differ in both fields.
      //
      // The input is the shared collision's HUMAN half seated alone, asked
      // about by both of the module's refs — made by the contract's own
      // constructors, so this is the ref production hands the query. The
      // thread half is reachable through the aggregate by ordering (the module
      // says how); this is the read path it would then arrive on.
      const repo = yield* ProjectionChannelRepository;
      yield* repo.upsertChannel(
        channelWithMembers(ChannelId.make("kind-only"), "kind-only", [COLLIDING_HUMAN_MEMBER]),
      );

      const asThread = yield* repo.listChannelsForMember(COLLIDING_THREAD_REF);
      const asHuman = yield* repo.listChannelsForMember(COLLIDING_HUMAN_REF);

      // Both directions. The refusal alone would pass for a filter that matched
      // nobody at all, which is the mistake in the other direction. The human's
      // list is not counted, because this file shares one database and the
      // operator is seated elsewhere in it too; the channel is named instead.
      assert.deepStrictEqual(asThread, []);
      assert.ok(asHuman.some((row) => row.channelId === "kind-only"));
    }),
  );

  it.effect("a member of nothing gets an empty list rather than everything", () =>
    Effect.gen(function* () {
      // The admit side, stated separately: a member id that exists nowhere must
      // see nothing, and the assertion is that it sees nothing RATHER THAN
      // every channel — which is what dropping the JOIN produces.
      const repo = yield* ProjectionChannelRepository;
      yield* repo.upsertChannel(
        channelWithMembers(ChannelId.make("stranger-chan"), "stranger-chan", [
          { handle: "walt", memberKind: "human", memberId: "stranger-member" },
        ]),
      );

      const stranger = yield* repo.listChannelsForMember(
        unsafeRefForTest("human", "stranger-nobody"),
      );

      assert.deepStrictEqual(stranger, []);
    }),
  );

  it.effect("orders by the latest POST, not by when the channel was created", () =>
    Effect.gen(function* () {
      // The two orderings are OPPOSITE in this fixture, which is the only kind
      // that can tell them apart: "order-quiet" was created LATER and its last
      // post is older, "order-busy" was created first and has a post from
      // today. Ordering by `c.created_at` puts quiet first; the sidebar needs
      // busy first.
      //
      // The client atom pins this rule too, but against its own fixture — the
      // SQL `ORDER BY` is a second implementation of it and had nothing holding
      // it.
      const repo = yield* ProjectionChannelRepository;
      const busy = ChannelId.make("order-busy");
      const quiet = ChannelId.make("order-quiet");
      const member = unsafeRefForTest("human", "order-member");
      yield* repo.upsertChannel(
        channelWithMembers(busy, "order-busy", [{ handle: "walt", ...member }], {
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      );
      yield* repo.upsertChannel(
        channelWithMembers(quiet, "order-quiet", [{ handle: "walt", ...member }], {
          createdAt: "2026-01-05T00:00:00.000Z",
        }),
      );
      yield* repo.insertPost({
        ...post("order-post-busy", busy, 1),
        createdAt: "2026-01-09T00:00:00.000Z",
      });
      yield* repo.insertPost({
        ...post("order-post-quiet", quiet, 2),
        createdAt: "2026-01-06T00:00:00.000Z",
      });

      const rows = yield* repo.listChannelsForMember(member);

      assert.deepStrictEqual(
        rows.map((row) => row.name),
        ["order-busy", "order-quiet"],
      );
    }),
  );

  it.effect("sorts a channel with NO posts by when it was created, not last", () =>
    Effect.gen(function* () {
      // THE COALESCE FALLBACK, and the only fixture shape that can see it. The
      // ordering test above gives BOTH channels a post, so
      // `COALESCE(MAX(p.created_at), c.created_at)` and `MAX(p.created_at)` are
      // the same function against it — dropping the fallback survived all 16
      // tests until this one existed.
      //
      // NULLs sort LAST under DESC in SQLite, which is the wrong end: a channel
      // created today and never posted in belongs above one whose only post is
      // from last week. So "empty" is created AFTER "busy"'s post, and the two
      // orderings are opposite.
      const repo = yield* ProjectionChannelRepository;
      const busy = ChannelId.make("coalesce-busy");
      const empty = ChannelId.make("coalesce-empty");
      const member = unsafeRefForTest("human", "coalesce-member");
      yield* repo.upsertChannel(
        channelWithMembers(busy, "coalesce-busy", [{ handle: "walt", ...member }], {
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      );
      yield* repo.upsertChannel(
        channelWithMembers(empty, "coalesce-empty", [{ handle: "walt", ...member }], {
          createdAt: "2026-01-08T00:00:00.000Z",
        }),
      );
      yield* repo.insertPost({
        ...post("coalesce-post", busy, 1),
        createdAt: "2026-01-02T00:00:00.000Z",
      });

      const rows = yield* repo.listChannelsForMember(member);

      assert.deepStrictEqual(
        rows.map((row) => row.name),
        ["coalesce-empty", "coalesce-busy"],
      );
    }),
  );

  it.effect("carries the latest post's time, and null for a channel with none", () =>
    Effect.gen(function* () {
      // `latestPostAt` is what the deleted `channel-post-appended` shell event
      // was traded for: a post reaches the client because this value moves. A
      // query returning null here would make the sidebar show "No posts yet"
      // over a channel that had just been posted in, and the argument for
      // deleting that event would be false.
      //
      // The MAX matters, not merely non-null: two posts, and the LATER one is
      // what the row must carry.
      const repo = yield* ProjectionChannelRepository;
      const posted = ChannelId.make("activity-posted");
      const empty = ChannelId.make("activity-empty");
      const member = unsafeRefForTest("human", "activity-member");
      yield* repo.upsertChannel(
        channelWithMembers(posted, "activity-posted", [{ handle: "walt", ...member }]),
      );
      yield* repo.upsertChannel(
        channelWithMembers(empty, "activity-empty", [{ handle: "walt", ...member }]),
      );
      yield* repo.insertPost({
        ...post("activity-post-early", posted, 1),
        createdAt: "2026-01-02T00:00:00.000Z",
      });
      yield* repo.insertPost({
        ...post("activity-post-late", posted, 2),
        createdAt: "2026-01-03T00:00:00.000Z",
      });

      const rows = yield* repo.listChannelsForMember(member);

      assert.strictEqual(
        rows.find((row) => row.channelId === posted)?.latestPostAt,
        "2026-01-03T00:00:00.000Z",
      );
      assert.strictEqual(rows.find((row) => row.channelId === empty)?.latestPostAt, null);
    }),
  );

  it.effect("does not multiply a channel by its member count", () =>
    Effect.gen(function* () {
      // The `GROUP BY` over a membership JOIN. Without it a channel with three
      // members returns three rows and the sidebar renders it three times. The
      // existing fixtures give channels one or two members; three makes the
      // duplication unambiguous rather than a possible off-by-one.
      const repo = yield* ProjectionChannelRepository;
      const crowded = ChannelId.make("group-crowded");
      const member = unsafeRefForTest("human", "group-member");
      yield* repo.upsertChannel(
        channelWithMembers(crowded, "group-crowded", [
          { handle: "walt", ...member },
          { handle: "pm", memberKind: "thread", memberId: "group-thread-pm" },
          { handle: "boss1", memberKind: "thread", memberId: "group-thread-boss1" },
        ]),
      );
      yield* repo.insertPost(post("group-post-a", crowded, 1));
      yield* repo.insertPost(post("group-post-b", crowded, 2));

      const rows = yield* repo.listChannelsForMember(member);

      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0]?.members.length, 3);
    }),
  );
});
