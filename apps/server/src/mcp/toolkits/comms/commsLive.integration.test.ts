/**
 * The comms toolkit against the REAL aggregate, through the REAL gateway.
 *
 * Every other test in this directory fakes the gateway. The seam test runs the
 * toolkit's output through the decider's invariants, which catches disagreement
 * about a RULE. Neither can catch a wiring mistake, and wiring is what this
 * bead is: a gateway that dispatches without an issuer looks correct, compiles,
 * and refuses every post — its own tests would pass, because they never dispatch.
 *
 * So this drives the toolkit's handlers through `ChannelGatewayLive` onto a real
 * engine and a real projection, and asserts what the aggregate STORED.
 *
 * @module commsLive.integration.test
 */
import {
  ChannelId,
  ChannelMemberHandle,
  CommandId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/unstable/ai";

import { OrchestrationLayerLive } from "../../../orchestration/runtimeLayer.ts";
import type { OrchestrationDispatchError } from "../../../orchestration/Errors.ts";
import {
  OrchestrationCommandInvariantError,
  OrchestrationCommandIdConflictError,
} from "../../../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { makeSqlitePersistenceLive } from "../../../persistence/Layers/Sqlite.ts";
import { ProjectionChannelRepository } from "../../../persistence/Services/ProjectionChannels.ts";
import * as RepositoryIdentityResolver from "../../../project/RepositoryIdentityResolver.ts";
import { ServerConfig } from "../../../config.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { MentionWakeReactor } from "../../../orchestration/Services/MentionWakeReactor.ts";
import { MentionWakeReactorLive } from "../../../orchestration/Layers/MentionWakeReactor.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ChannelGateway } from "./channelGateway.ts";
import { ChannelGatewayLive } from "./channelGatewayLive.ts";
import { CommsToolkitHandlersLive } from "./handlers.ts";
import { CommsToolkit } from "./tools.ts";

const PROJECT_ID = ProjectId.make("project-comms-live");
const BOSS3 = ThreadId.make("thread-boss3-live");
const BOSS1 = ThreadId.make("thread-boss1-live");
const CHANNEL_ID = ChannelId.make("channel-seniors-live");
const NOW = "2026-01-01T00:00:00.000Z";
const ADMIN = { memberKind: "human", memberId: "human-walt" } as const;

/** Everything under the gateway, so a test can rebuild it over a tapped engine. */
const BaseLayer = OrchestrationLayerLive.pipe(
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provideMerge(makeSqlitePersistenceLive(":memory:")),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-comms-live-" })),
  Layer.provideMerge(NodeServices.layer),
);

const TestLayer = CommsToolkitHandlersLive.pipe(
  Layer.provideMerge(ChannelGatewayLive),
  Layer.provideMerge(MentionWakeReactorLive),
  Layer.provideMerge(OrchestrationLayerLive),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provideMerge(makeSqlitePersistenceLive(":memory:")),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-comms-live-" })),
  Layer.provideMerge(NodeServices.layer),
);

/**
 * The real engine, with `dispatch` made to fail.
 *
 * A TAP rather than a stand-in: the gateway also reads the projection the real
 * engine's pipeline maintains, so replacing the service would replace the
 * thing under test. It exists because the gateway's conflict branch cannot be
 * reached end to end - the toolkit pre-checks everything the decider would
 * refuse, so a state the aggregate can be put into is caught before any
 * dispatch happens.
 */
const dispatchFailsWith = (error: OrchestrationDispatchError) =>
  Layer.effect(
    OrchestrationEngineService,
    Effect.gen(function* () {
      const real = yield* OrchestrationEngineService;
      return {
        ...real,
        dispatch: (
          command: Parameters<typeof real.dispatch>[0],
          options?: Parameters<typeof real.dispatch>[1],
        ) =>
          // Only the post fails. The seeding dispatches have to land or there
          // is no channel to post into, and the failure under test is never
          // reached - which is exactly what happened on the first attempt,
          // silently, because the post SUCCEEDED and the assertion was about
          // the failure's shape.
          command.type === "channel.post.create"
            ? Effect.fail(error)
            : real.dispatch(command, options),
      };
    }),
  );

const invocation = (threadId: ThreadId): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  threadId,
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("claude"),
  capabilities: new Set<McpInvocationContext.McpCapability>(["comms"]),
  issuedAt: 1,
});

/** A project, two agent threads, and a channel both are members of. */
const seed = Effect.fn("seedCommsLive")(function* () {
  const engine = yield* OrchestrationEngineService;
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make("cmd-project-live"),
    projectId: PROJECT_ID,
    title: "Comms",
    workspaceRoot: "/workspace/comms-live",
    createdAt: NOW,
  });
  for (const [threadId, title] of [
    [BOSS3, "Boss3"],
    [BOSS1, "Boss1"],
  ] as const) {
    yield* engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`cmd-thread-${threadId}`),
      projectId: PROJECT_ID,
      threadId,
      title,
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: NOW,
    });
  }
  yield* engine.dispatch(
    {
      type: "channel.create",
      commandId: CommandId.make("cmd-channel-live"),
      channelId: CHANNEL_ID,
      name: "seniors",
      members: [
        { handle: ChannelMemberHandle.make("boss3"), memberKind: "thread", memberId: BOSS3 },
        { handle: ChannelMemberHandle.make("boss1"), memberKind: "thread", memberId: BOSS1 },
      ],
      createdAt: NOW,
    },
    { issuer: ADMIN },
  );
});

const call = Effect.fn("callCommsTool")(function* <Name extends keyof typeof CommsToolkit.tools>(
  name: Name,
  params: unknown,
  threadId: ThreadId,
) {
  const toolkit = yield* CommsToolkit;
  return yield* toolkit.handle(name, params as never).pipe(
    Stream.unwrap,
    Stream.runCollect,
    Effect.map((chunk) => chunk.at(-1)!.result as Tool.Success<(typeof CommsToolkit.tools)[Name]>),
    Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(threadId)),
  );
});

describe("the comms toolkit on the live gateway", () => {
  it.effect(
    "posts as the CREDENTIAL's thread, whatever the arguments say",
    () =>
      Effect.gen(function* () {
        yield* seed();

        // The probe a44 asked for and ax9 kept open: an agent calls with
        // arguments it chose, and what lands carries the author the CREDENTIAL
        // names. There is no argument for an author any more - the command has
        // no such field - so the only way to be wrong here is for the gateway to
        // dispatch without an issuer, which the decider refuses outright.
        const posted = yield* call(
          "comms_post",
          { channel: "#SENIORS", body: "over to you", mentions: ["@Boss1"] },
          BOSS3,
        );
        expect(posted.channel).toBe("seniors");
        expect(posted.mentioned).toEqual(["boss1"]);

        const channels = yield* ProjectionChannelRepository;
        const stored = yield* channels.listPosts({
          channelId: CHANNEL_ID,
          limit: 10,
          afterSequence: undefined,
        });
        expect(stored).toHaveLength(1);
        // The author is the credential's thread, resolved by the DECIDER from
        // the channel's membership - not anything the caller sent.
        expect(stored[0]?.authorHandle).toBe("boss3");
        expect(stored[0]?.mentions).toEqual(["boss1"]);
        expect(stored[0]?.postId).toBe(posted.postId);
        // THE BODY, which this test's own docstring promised and did not check.
        // Replacing `body: input.body` with a constant in the dispatched
        // command reds only the mention-wake test, and only because the wake's
        // fenced text happens to carry it - so redacting every post body ships
        // green the day that test changes.
        expect(stored[0]?.body).toBe("over to you");
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "reads back what the other agent posted, through the same tools",
    () =>
      Effect.gen(function* () {
        yield* seed();
        yield* call("comms_post", { channel: "seniors", body: "from boss1" }, BOSS1);

        // The round trip is the feature: one agent posts, another reads it by
        // name, and the handle it sees is the handle a mention needs.
        const read = yield* call("comms_read_channel", { channel: "seniors" }, BOSS3);
        // BY HANDLE, not by insertion order. The projection returns members
        // sorted, and asserting the order the channel was created in passed
        // nothing and failed here - worth pinning as the order it IS, so the
        // next reader does not build an agent that indexes into this list.
        expect(read.members).toEqual(["boss1", "boss3"]);
        expect(read.posts.map((post) => post.author)).toEqual(["boss1"]);

        // The handle is FOUND rather than indexed, for the same reason.
        const other = read.members.find((handle) => handle !== "boss3");
        expect(other).toBe("boss1");
        const mentioned = yield* call(
          "comms_post",
          { channel: "seniors", body: "seen", mentions: [other!] },
          BOSS3,
        );
        expect(mentioned.mentioned).toEqual(["boss1"]);

        // TWO POSTS INTO ONE CHANNEL, which nothing did before. The command id
        // derives from the post id (`comms-post:${postId}`), so a generator
        // that returned a constant would have the engine absorb the second
        // post as a replay of the first: the agent is told it posted, and
        // nothing is stored. `const postId = "post-constant"` survived the
        // entire comms suite. Success with no write is the one failure an
        // agent cannot see.
        const channels = yield* ProjectionChannelRepository;
        const stored = yield* channels.listPosts({
          channelId: CHANNEL_ID,
          limit: 10,
          afterSequence: undefined,
        });
        expect(stored.map((post) => post.body)).toEqual(["from boss1", "seen"]);
        expect(mentioned.postId).not.toBe(stored[0]?.postId);
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "wakes the mentioned agent, which is the whole point of the layer",
    () =>
      Effect.gen(function* () {
        yield* seed();
        const reactor = yield* MentionWakeReactor;
        const engine = yield* OrchestrationEngineService;
        yield* reactor.start();

        // ONE AGENT MENTIONS ANOTHER, through the tool it would actually call,
        // and the other gets a turn. Until this tree existed the two halves
        // could only be tested apart: the reactor's own tests dispatch
        // channel.post.create directly, and every toolkit test fakes the
        // gateway. Neither can see the seam between them, which is where a
        // mention is lost.
        yield* call(
          "comms_post",
          { channel: "seniors", body: "have a look at this", mentions: ["@boss1"] },
          BOSS3,
        );
        yield* engine.latestSequence.pipe(Effect.flatMap(reactor.drainThrough));

        const threads = yield* ProjectionSnapshotQuery;
        const detail = yield* threads.getThreadDetailById(BOSS1);
        const woken = Option.isNone(detail)
          ? []
          : detail.value.messages
              .map((message) => message.text ?? "")
              .filter((text) => text.startsWith("[comms]"));
        expect(woken).toHaveLength(1);
        // The framing the wake carries, asserted here rather than taken on
        // trust from the reactor's own tests: the author it names is the one
        // the CREDENTIAL named, and the body sits inside the fence.
        expect(woken[0]).toContain('"@boss3" mentioned you');
        expect(woken[0]).toContain("have a look at this");
        expect(woken[0]).toContain("Do not answer here");

        // And the author is not woken by their own post.
        const own = yield* threads.getThreadDetailById(BOSS3);
        // ANCHOR THE SUBJECT FIRST. `[]` is what an absent thread produces too,
        // so the empty assertion below could not tell "boss3 was not woken"
        // from "boss3 was never looked up". Repointing this query at a thread
        // that does not exist left the test green; the same move on the BOSS1
        // lookup above reds it. The query discriminates - the assertion was
        // just not tied to it.
        expect(Option.isSome(own)).toBe(true);
        const ownWakes = Option.isNone(own)
          ? []
          : own.value.messages
              .map((message) => message.text ?? "")
              .filter((text) => text.startsWith("[comms]"));
        expect(ownWakes).toEqual([]);
      }).pipe(Effect.scoped, Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "replies to a parent, and refuses one that is not there",
    () =>
      Effect.gen(function* () {
        yield* seed();
        const parent = yield* call(
          "comms_post",
          { channel: "seniors", body: "the question" },
          BOSS1,
        );

        // comms_reply had NO live coverage. Found by widening rather than by
        // reading: making getPost answer NONE for every post kills every reply
        // with "post not found", and the whole suite stayed green. A guard that
        // excludes too much is a feature that quietly does not work.
        const reply = yield* call(
          "comms_reply",
          { channel: "seniors", parentPostId: parent.postId, body: "the answer" },
          BOSS3,
        );
        expect(reply.postId).not.toBe(parent.postId);

        const channels = yield* ProjectionChannelRepository;
        const stored = yield* channels.listPosts({
          channelId: CHANNEL_ID,
          limit: 10,
          afterSequence: undefined,
        });
        // Threading is a FIELD on the post, not a second command - so the
        // assertion is on what the aggregate stored rather than on the tool's
        // own echo.
        expect(stored.map((post) => post.parentPostId)).toEqual([null, parent.postId]);
        expect(stored.map((post) => post.authorHandle)).toEqual(["boss1", "boss3"]);

        // And a parent that does not exist is refused BEFORE anything is
        // written, with the id the agent supplied - so it can tell which of
        // several replies failed.
        const missing = yield* call(
          "comms_reply",
          { channel: "seniors", parentPostId: "post-does-not-exist", body: "into the void" },
          BOSS3,
        ).pipe(Effect.flip);
        expect(missing).toMatchObject({
          _tag: "CommsPostNotFoundError",
          postId: "post-does-not-exist",
        });
        const after = yield* channels.listPosts({
          channelId: CHANNEL_ID,
          limit: 10,
          afterSequence: undefined,
        });
        expect(after).toHaveLength(2);

        // AN ID THE BRAND REFUSES MUST FAIL THE SAME WAY AN ABSENT ONE DOES.
        // `t3_bot-2d2` made `ChannelPostId` refuse anything outside its
        // charset, and `.make` THROWS on refusal - so calling it in an argument
        // list threw while `channels.getPost(...)` was being called, before the
        // `Effect.catchCause` guard on that very line had been attached. The
        // agent got a defect carrying a schema stack trace instead of "no such
        // post". `parentPostId` is agent-supplied and the tool schema checks
        // only that it is non-empty, so every one of these is reachable from a
        // real call.
        for (const malformed of ["a:b", "has space", "   ", "post-\u{1F525}", "x".repeat(65)]) {
          const refused = yield* call(
            "comms_reply",
            { channel: "seniors", parentPostId: malformed, body: "into the void" },
            BOSS3,
          ).pipe(Effect.flip);
          // The TAG, not just "it failed": a defect surfaces through the
          // toolkit as a failed tool call too, so asserting failure alone
          // cannot tell a typed refusal from a crash that was caught.
          expect(refused).toMatchObject({ _tag: "CommsPostNotFoundError" });
        }

        // And nothing was written by any of them.
        const untouched = yield* channels.listPosts({
          channelId: CHANNEL_ID,
          limit: 10,
          afterSequence: undefined,
        });
        expect(untouched).toHaveLength(2);
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "pages a channel, and says when there is more",
    () =>
      Effect.gen(function* () {
        yield* seed();
        for (const body of ["first", "second", "third"]) {
          yield* call("comms_post", { channel: "seniors", body }, BOSS1);
        }

        // nextCursor had no coverage either: returning null always left the
        // suite green, and an agent tailing a channel would simply never see a
        // second page. Nothing about that looks like a failure from the
        // agent's side - the channel just appears to stop.
        const firstPage = yield* call(
          "comms_read_channel",
          { channel: "seniors", limit: 2 },
          BOSS3,
        );
        expect(firstPage.posts.map((post) => post.body)).toEqual(["first", "second"]);
        expect(firstPage.nextCursor).not.toBeNull();

        const secondPage = yield* call(
          "comms_read_channel",
          { channel: "seniors", limit: 2, cursor: firstPage.nextCursor! },
          BOSS3,
        );
        // The cursor points AFTER the last post returned, so the next page
        // starts at the one following it rather than repeating it.
        expect(secondPage.posts.map((post) => post.body)).toEqual(["third"]);
        // And the end of the channel says so, which is what lets an agent stop
        // rather than poll forever.
        expect(secondPage.nextCursor).toBeNull();

        // A CURSOR THAT IS NOT A CURSOR IS REFUSED, not answered. `Number()`
        // has no failure case on an arbitrary string: "post-2" became NaN,
        // matched no row, and came back as an empty page with nextCursor null
        // - which is byte-for-byte the answer for "you are caught up". Three
        // unread posts behind a successful reply, on the feature whose entire
        // purpose is catching up. A post id is the likely wrong value to send,
        // since posts and cursors are both bare strings in the result.
        // "9007199254740993" is the one that matters, and it is the defect the
        // FIRST version of this fix introduced. It is DIGITS, so an unbounded
        // `^[0-9]+$` admitted it; it then exceeded Number.MAX_SAFE_INTEGER and
        // threw inside the gateway while the query argument was being built -
        // before the read's `catchCause` had anything to attach to. Agent input
        // became a server defect, and it was a regression in KIND: before the
        // cursor was validated at all, that same value coerced silently and
        // returned a page.
        for (const notACursor of [
          "post-2",
          "abc",
          "  ",
          "-1",
          "1.5",
          "0x2",
          "1e999",
          "9007199254740993",
          "99999999999999999999",
        ]) {
          const refused = yield* call(
            "comms_read_channel",
            { channel: "seniors", limit: 2, cursor: notACursor },
            BOSS3,
          ).pipe(Effect.flip);
          // Whatever it says, it must not be an empty page: an agent cannot
          // tell a wrong answer from the end of the channel, and it stops.
          expect(refused).toBeDefined();
          expect(refused).not.toMatchObject({ posts: [], nextCursor: null });
        }

        // The rewind half of the same defect: "  " and "-1" coerced to 0 and
        // silently re-served the OLDEST page, so an agent paging forward would
        // loop over the same posts forever rather than stop.
        const stillWorks = yield* call(
          "comms_read_channel",
          { channel: "seniors", limit: 2, cursor: firstPage.nextCursor! },
          BOSS3,
        );
        expect(stillWorks.posts.map((post) => post.body)).toEqual(["third"]);
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "does not tell an agent to retry a post that can never land",
    () =>
      Effect.gen(function* () {
        yield* seed();
        const engine = yield* OrchestrationEngineService;
        // A member removed between the toolkit's check and the write is the
        // race the gateway's conflict branch exists for - but the refusal that
        // comes back is the DECIDER's, and it is permanent for this input.
        yield* engine.dispatch(
          {
            type: "channel.member.remove",
            commandId: CommandId.make("cmd-remove-boss1-retry"),
            channelId: CHANNEL_ID,
            handle: ChannelMemberHandle.make("boss1"),
          },
          { issuer: ADMIN },
        );

        const error = yield* call(
          "comms_post",
          { channel: "seniors", body: "still there?", mentions: ["boss1"] },
          BOSS3,
        ).pipe(Effect.flip);

        // Whatever the agent is told, it must not be "try again" - retrying
        // this post refuses identically, forever, and the agent has nothing
        // else to act on.
        expect((error as { message: string }).message).not.toContain("Try again");

        // AND IT IS THE TOOLKIT THAT REFUSES, not the gateway - which is why
        // this test does NOT pin the gateway's retryable discriminator, and
        // says so rather than implying it does. The toolkit pre-checks mentions
        // against membership, so a removed member is caught before any dispatch
        // and the conflict branch is never reached. Hardcoding the gateway back
        // to `retryable: true` leaves this green. Measured, not assumed.
        //
        // The gateway's branch is reachable only on a genuine race or an
        // infrastructure failure, so pinning it needs an injected dispatch
        // failure rather than a state the aggregate can be put into.
        expect((error as { _tag: string })._tag).toBe("CommsMemberNotFoundError");
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "says retry only for a failure that retrying could fix",
    () =>
      Effect.gen(function* () {
        // The tap is UNDER the gateway, not beside it: a gateway built over the
        // real engine has already closed over it, and providing a failing one
        // afterwards changes nothing. The first version of this test did that
        // and the post SUCCEEDED - which the assertion read as a mismatched
        // object rather than as "the injection never happened".
        const attempt = (error: OrchestrationDispatchError) =>
          Effect.gen(function* () {
            yield* seed();
            const gateway = yield* ChannelGateway;
            return yield* gateway
              .createPost({
                channelId: CHANNEL_ID,
                threadId: BOSS3,
                body: "into a failing dispatch",
                mentions: [],
                parentPostId: null,
              })
              .pipe(Effect.flip);
          }).pipe(
            Effect.provide(
              ChannelGatewayLive.pipe(
                Layer.provide(dispatchFailsWith(error)),
                Layer.provideMerge(BaseLayer),
              ),
            ),
          );

        // THE DECIDER'S OWN REFUSAL is permanent for this input. Retrying the
        // same post refuses identically, forever, and "try again" is then an
        // instruction to loop with nothing else to act on.
        const rejected = yield* attempt(
          new OrchestrationCommandInvariantError({
            commandType: "channel.post.create",
            detail: "Mentions do not resolve to members of channel 'x': ghost.",
          }),
        );
        expect(rejected).toMatchObject({ _tag: "ChannelWriteConflict", retryable: false });

        // ANYTHING ELSE is infrastructure and is worth trying again. Both
        // directions, because a discriminator asserted in one direction is
        // satisfied by a constant.
        const infrastructure = yield* attempt(
          new OrchestrationCommandIdConflictError({
            commandId: "comms-post:whatever",
            receiptAggregateKind: "channel",
            receiptAggregateId: "channel-other",
            commandAggregateKind: "channel",
            commandAggregateId: CHANNEL_ID,
          }),
        );
        expect(infrastructure).toMatchObject({ _tag: "ChannelWriteConflict", retryable: true });
      }),
    30_000,
  );

  it.effect(
    "refuses a post to an archived channel, and still reads it",
    () =>
      Effect.gen(function* () {
        yield* seed();
        // POSTS FIRST, so the read below has a history to fail to return. The
        // earlier version archived an EMPTY channel, which made "still reads
        // it" unable to tell "pages the history" from "there was no history".
        for (const body of ["before the archive", "also before"]) {
          yield* call("comms_post", { channel: "seniors", body }, BOSS1);
        }
        const engine = yield* OrchestrationEngineService;
        yield* engine.dispatch(
          {
            type: "channel.archive",
            commandId: CommandId.make("cmd-archive-live"),
            channelId: CHANNEL_ID,
          },
          { issuer: ADMIN },
        );

        // READABLE, NOT POSTABLE - through the live layer rather than a fake
        // that was told to fail. Without the archived read in the gateway the
        // refusal arrives as one invariant error among several and says "could
        // not post" in the decider's words, naming no channel.
        const error = yield* call(
          "comms_post",
          { channel: "seniors", body: "anyone still here" },
          BOSS3,
        ).pipe(Effect.flip);
        expect((error as { _tag: string })._tag).toBe("CommsChannelArchivedError");
        expect((error as { message: string }).message).toContain("seniors");

        const read = yield* call("comms_read_channel", { channel: "seniors" }, BOSS3);
        expect(read.channel).toBe("seniors");
        // THE HISTORY IS STILL THERE. Archiving hides nothing that was already
        // said: a member keeps reading what they could read before, and only
        // writing stops. A UI listing an archived channel opens onto its
        // history and disables the composer, rather than onto an error.
        expect(read.posts.map((post) => post.body)).toEqual(["before the archive", "also before"]);
        expect(read.members).toEqual(["boss1", "boss3"]);
        // AND THE READ SAYS SO, which is the only way an agent learns without
        // burning a post to find out. Archived became a first-class channel
        // state in this change and had no surface showing it: the refusal
        // above was the whole of the signal, after the fact.
        expect(read.postable).toBe(false);
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "treats a cursor that is not a sequence as a DEFECT, for the caller the schema does not cover",
    () =>
      Effect.gen(function* () {
        yield* seed();
        const gateway = yield* ChannelGateway;

        // Unreachable through the toolkit, whose schema refuses these first -
        // so this calls the gateway directly, the same way the non-canonical
        // name below is tested. Without it the guard is inert: reverting
        // `requireSequence` on its own reds nothing, because every input that
        // would reach it is stopped one layer up.
        //
        // The guard is what holds if that layer is ever widened, and its
        // docstring says so. A docstring making a claim about a guard nothing
        // exercises is the thing this branch has spent the day deleting.
        for (const notASequence of ["abc", "-1", "1.5", "9007199254740993"]) {
          const defect = yield* gateway
            .readPosts({ channelId: CHANNEL_ID, limit: 10, cursor: notASequence })
            .pipe(Effect.exit);
          expect(defect._tag).toBe("Failure");
          expect(String(defect)).toContain("not a sequence");
        }

        // And a real cursor still reads, so the assertions above are about the
        // VALUE rather than about readPosts refusing everything.
        const page = yield* gateway.readPosts({
          channelId: CHANNEL_ID,
          limit: 10,
          cursor: undefined,
        });
        expect(page.posts).toEqual([]);

        // THE SAME PROPERTY FOR `getPost`, which brands a channelId the caller
        // supplies. `Effect.exit` can only produce an Exit VALUE if the Effect
        // was built at all - a throw while the function is being called never
        // reaches it, and fails the test uncatchably instead. That distinction
        // is the whole of what the suspends buy and it is invisible to any
        // assertion that only checks THAT it failed.
        //
        // What comes back is a DEFECT, not a typed failure: the exit is a
        // Failure whose cause is a Die. `readPosts` declares only
        // `ChannelStoreUnavailable`, so a malformed id here is still a caller
        // bug - what the suspend changes is that the bug is reportable rather
        // than escaping.
        const unbrandable = yield* gateway.getPost("not a channel id", "post-1").pipe(Effect.exit);
        expect(unbrandable._tag).toBe("Failure");

        // AND `createPost` HONOURS ITS OWN SIGNATURE. It declares five typed
        // failures; a malformed parent used to come out as a raw schema Die
        // with a serialised AST, so a caller writing an exhaustive `catchTags`
        // would look correct and be wrong. The toolkit never reached it -
        // `comms_reply` resolves the parent first - which is exactly why
        // nothing tested it.
        for (const malformed of ["a:b", "has space", "   ", "post-\u{1F525}"]) {
          const refused = yield* gateway
            .createPost({
              channelId: CHANNEL_ID,
              threadId: BOSS3,
              body: "replying to nothing",
              mentions: [],
              parentPostId: malformed,
            })
            .pipe(Effect.exit);
          expect(refused._tag).toBe("Failure");
          // A TYPED refusal, not a defect. `Effect.flip` could not tell these
          // apart: it propagates a die rather than yielding it as a value.
          expect(String(refused)).toContain("ChannelWriteConflict");
          expect(String(refused)).not.toContain("SchemaIssue");
        }

        // THE MENTIONS ARRAY IS NOT THE SAME SITE, and it is worth the four
        // lines to say why rather than leaving the next reader to re-derive it.
        // `ChannelMemberHandle` is a trimmed non-empty string, so a handle of
        // only whitespace LOOKS like it should throw - but `.make` checks
        // `isNonEmpty` against the untrimmed value, which has length 3, so it
        // constructs fine and the DECIDER refuses it by canonicalising. The
        // result is a typed `ChannelWriteConflict`, which is what this asserts.
        //
        // So this is not provenance and not luck: the value is genuinely
        // handled. The assertion exists because that is a chain of three
        // non-obvious facts, and a defect appearing here later would mean one
        // of them changed.
        const blankHandle = yield* gateway
          .createPost({
            channelId: CHANNEL_ID,
            threadId: BOSS3,
            body: "mentioning nobody in particular",
            mentions: ["   "],
            parentPostId: null,
          })
          .pipe(Effect.exit);
        expect(blankHandle._tag).toBe("Failure");
        expect(String(blankHandle)).toContain("ChannelWriteConflict");
        expect(String(blankHandle)).not.toContain("SchemaIssue");
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "treats a non-canonical name as a DEFECT rather than an empty answer",
    () =>
      Effect.gen(function* () {
        yield* seed();
        const gateway = yield* ChannelGateway;

        // Unreachable through the toolkit, which canonicalises first - so this
        // calls the gateway directly, the only way to exercise a guard against
        // a FUTURE caller. Returning None instead would surface as an agent
        // told it is not in a channel it IS in, with nothing saying why.
        const defect = yield* gateway.getChannelForMember("#Seniors", BOSS3).pipe(Effect.exit);
        expect(defect._tag).toBe("Failure");
        expect(String(defect)).toContain("non-canonical name");

        // The canonical form of the same name resolves, so the assertion above
        // is about the FORM rather than about the channel being absent.
        const found = yield* gateway.getChannelForMember("seniors", BOSS3);
        expect(Option.isSome(found)).toBe(true);
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "hides a channel the calling thread is not a member of, through the live projection",
    () =>
      Effect.gen(function* () {
        yield* seed();
        const engine = yield* OrchestrationEngineService;
        yield* engine.dispatch(
          {
            type: "channel.member.remove",
            commandId: CommandId.make("cmd-remove-boss3"),
            channelId: CHANNEL_ID,
            handle: ChannelMemberHandle.make("boss3"),
          },
          { issuer: ADMIN },
        );

        const error = yield* call("comms_read_channel", { channel: "seniors" }, BOSS3).pipe(
          Effect.flip,
        );

        // THE TWO ANSWERS COMPARED TO EACH OTHER, which is the only form of
        // this assertion that holds the property. A caller able to tell "no
        // such channel" from "exists, you are not in it" can enumerate private
        // channel names by probing.
        //
        // The seam used to hold that structurally - membership was a PARAMETER
        // of the lookup - and this layer does not: the lookup runs first and
        // membership is a guard after it, returning `Option.none` from two
        // distinct branches two lines apart. Three tests pinned this, each
        // against its own hardcoded literal, so giving either branch a
        // distinguishing field left all three green (`t3_bot-glu`).
        //
        // The names cannot match: each error echoes what the CALLER asked for.
        // Substituting each request's own name is what isolates the property -
        // nothing in the answer varies with what is STORED.
        const missing = yield* call(
          "comms_read_channel",
          { channel: "no-such-channel" },
          BOSS3,
        ).pipe(Effect.flip);
        const shape = (value: unknown, asked: string) =>
          JSON.stringify(value, (_key, inner: unknown) =>
            typeof inner === "string" ? inner.split(asked).join("<asked>") : inner,
          );
        expect(shape(error, "seniors")).toBe(shape(missing, "no-such-channel"));

        expect((error as { _tag: string })._tag).toBe("CommsChannelNotFoundError");
        expect((error as { message: string }).message).toBe(
          "No channel named 'seniors' that you are a member of.",
        );

        // And the channel is still there for the member who remains, so the
        // assertion above is about MEMBERSHIP rather than about the channel
        // having gone.
        const stillThere = yield* call("comms_read_channel", { channel: "seniors" }, BOSS1);
        expect(stillThere.members).toEqual(["boss1"]);
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );
});
