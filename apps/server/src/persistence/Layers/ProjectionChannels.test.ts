import { ChannelId, ChannelMemberHandle, ChannelPostId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionChannelRepositoryLive } from "./ProjectionChannels.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionChannelRepository } from "../Services/ProjectionChannels.ts";

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
});
