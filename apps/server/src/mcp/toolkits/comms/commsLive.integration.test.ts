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
  HUMAN_OPERATOR_MEMBER_ID,
  ChannelMemberHandle,
  CommandId,
  EnvironmentId,
  type OrchestrationCommand,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
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
import {
  COLLIDING_HUMAN_REF,
  COLLIDING_THREAD_REF,
  collidingMembers,
} from "../../../orchestration/testing/collidingRoster.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { refFromOperatorSession } from "@t3tools/contracts";
import { ChannelGateway, type ChannelMemberRef, refFromMcpCredential } from "./channelGateway.ts";
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

/**
 * The real engine, with one real command slipped in BETWEEN the toolkit's
 * check and its write.
 *
 * The toolkit pre-checks membership, mentions and archived against the channel
 * it read, so the aggregate's own refusals of a post are reachable only when
 * the channel changes after that read and before the post lands. This is the
 * one place that gap can be held open on purpose: the post's dispatch arrives
 * here with the toolkit's checks already passed, the interposed command goes
 * through the REAL engine first, and the post then meets the REAL decider over
 * the changed channel. Unlike `dispatchFailsWith`, nothing about the refusal
 * is injected - only its timing.
 */
const dispatchBeforePost = (interposed: OrchestrationCommand) =>
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
          command.type === "channel.post.create"
            ? real
                .dispatch(interposed, { issuer: ADMIN })
                .pipe(Effect.andThen(real.dispatch(command, options)))
            : real.dispatch(command, options),
      };
    }),
  );

/** The toolkit over the live gateway over a tapped engine; `seed` still sees the real one. */
const racedBy = (interposed: OrchestrationCommand) =>
  CommsToolkitHandlersLive.pipe(
    Layer.provideMerge(ChannelGatewayLive),
    Layer.provide(dispatchBeforePost(interposed)),
    Layer.provideMerge(BaseLayer),
  );

/**
 * The ONE way a test may forge a member ref, named so it cannot pass for the
 * real thing.
 *
 * `ChannelMemberRef` is a class with a private field precisely so a handler
 * cannot build one from a request payload. Not a unique-symbol brand, which was
 * the first attempt and is the wrong tool: a symbol stops an object LITERAL and
 * does not stop a spread of an existing ref with one field replaced, which is
 * the exact forgery this has to refuse. Tests that exercise refs no
 * legitimate source can produce - a colliding roster, a member kind the caller
 * is not - need a way in, and this is it: in a test file, with a name a
 * reviewer cannot read as production code. `makeRef` would not say that.
 */
const unsafeRefForTest = (memberKind: "thread" | "human", memberId: string) =>
  ({ memberKind, memberId }) as unknown as ChannelMemberRef;

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
    "tells the agent its post woke a thread and how that turn ended, by POST id",
    () =>
      Effect.gen(function* () {
        yield* seed();
        const reactor = yield* MentionWakeReactor;
        const engine = yield* OrchestrationEngineService;
        yield* reactor.start();

        const setSession = (
          activeTurnId: TurnId | null,
          status: "running" | "ready" | "interrupted",
          at: string,
        ) =>
          engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make(`cmd-session-${at}`),
            threadId: BOSS1,
            session: {
              threadId: BOSS1,
              status,
              providerName: "codex",
              providerInstanceId: ProviderInstanceId.make("codex"),
              runtimeMode: "full-access",
              activeTurnId,
              lastError: null,
              updatedAt: at,
            },
            createdAt: at,
          });

        // TWO POSTS, BOTH MENTIONING boss1, AND A TURN THAT STARTS BETWEEN
        // THEM. The first wakes boss1 from idle; the second lands while the
        // turn is running and is steered into it. That is the sequence in
        // which the projection loses the second post's link (`t3_bot-j6o`),
        // and the one an agent most needs to be able to read back.
        const first = yield* call(
          "comms_post",
          { channel: "seniors", body: "first", mentions: ["@boss1"] },
          BOSS3,
        );
        yield* engine.latestSequence.pipe(Effect.flatMap(reactor.drainThrough));
        const TURN = TurnId.make("turn-boss1-live");
        yield* setSession(TURN, "running", "2026-01-01T00:00:30.000Z");

        const second = yield* call(
          "comms_post",
          { channel: "seniors", body: "second", mentions: ["@boss1"] },
          BOSS3,
        );
        yield* engine.latestSequence.pipe(Effect.flatMap(reactor.drainThrough));
        yield* setSession(TURN, "running", "2026-01-01T00:01:30.000Z");

        // WHILE IT RUNS, both posts say so, each under its own id.
        const running = yield* call("comms_read_channel", { channel: "seniors" }, BOSS3);
        const byId = (page: typeof running) =>
          new Map(page.posts.map((post) => [post.postId, post.wakes] as const));
        expect(byId(running).get(first.postId)).toEqual([
          { threadId: BOSS1, turnId: TURN, outcome: "running" },
        ]);
        expect(byId(running).get(second.postId)).toEqual([
          { threadId: BOSS1, turnId: TURN, outcome: "running" },
        ]);

        // THEN THE TURN IS INTERRUPTED — THE WAY THE RUNTIME SAYS SO. The
        // projector settles a turn from the SESSION STATUS that follows it, not
        // from the interrupt command (`settledTurnStateForSessionStatus`), which
        // is criterion 1's whole point: a turn boundary the provider never
        // reported is not one the projection will record. So the fixture ends
        // the turn with a session-set of `interrupted`, which is what the
        // adapter emits, and not with `thread.turn.interrupt`, which alone
        // leaves the turn row `running`.
        //
        // The projection's word is "interrupted"; the agent's is "cancelled",
        // and that mapping is asserted here at the door rather than trusted
        // from the join's own tests.
        yield* setSession(null, "interrupted", "2026-01-01T00:02:00.000Z");

        const after = yield* call("comms_read_channel", { channel: "seniors" }, BOSS3);
        // BOTH POSTS, because both were folded into the one turn that died.
        // The second post is the one the projection had no link for; an agent
        // reading only the turn row would have been told about the first and
        // nothing about the second — criterion 2, on the wire.
        expect(byId(after).get(first.postId)).toEqual([
          { threadId: BOSS1, turnId: TURN, outcome: "cancelled" },
        ]);
        expect(byId(after).get(second.postId)).toEqual([
          { threadId: BOSS1, turnId: TURN, outcome: "cancelled" },
        ]);

        // AND A POST THAT WOKE NOBODY HAS NO `wakes` AT ALL — absent, not
        // empty — which is the only spelling the contract admits.
        const plain = yield* call("comms_post", { channel: "seniors", body: "no mention" }, BOSS3);
        yield* engine.latestSequence.pipe(Effect.flatMap(reactor.drainThrough));
        const withPlain = yield* call("comms_read_channel", { channel: "seniors" }, BOSS3);
        const plainPost = withPlain.posts.find((post) => post.postId === plain.postId);
        expect(plainPost).toBeDefined();
        expect("wakes" in plainPost!).toBe(false);
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
    "tells an agent its membership went, when it went between the check and the write",
    () =>
      Effect.gen(function* () {
        yield* seed();
        // THE RACE THE ERROR WAS WRITTEN FOR, run for real: the author is a
        // member when the toolkit reads the channel and is not when the
        // decider sees the post. Until `t3_bot-dnz` this reached the agent
        // as "the channel refused the post" - the decider's refusal was one
        // shape for every cause, and `CommsMembershipLostError` was produced
        // by test fakes only.
        const error = yield* call(
          "comms_post",
          { channel: "seniors", body: "am I still here" },
          BOSS3,
        ).pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "CommsMembershipLostError" });
        // WHAT THE AGENT READS carries neither the internal channelId nor the
        // decider's phrasing: the reason crossed the seam as a tag, and the
        // prose stayed a log line. #13 closed this and it stays closed.
        const message = (error as { message: string }).message;
        expect(message).not.toContain(CHANNEL_ID);
        expect(message).not.toContain("Orchestration command invariant failed");
      }).pipe(
        Effect.provide(
          racedBy({
            type: "channel.member.remove",
            commandId: CommandId.make("cmd-remove-author-raced"),
            channelId: CHANNEL_ID,
            handle: ChannelMemberHandle.make("boss3"),
          }),
        ),
      ),
    30_000,
  );

  it.effect(
    "names the mention that stopped resolving between the check and the write",
    () =>
      Effect.gen(function* () {
        yield* seed();
        // The toolkit resolved "boss1" against a roster that still had them.
        // The decider's list of what did NOT resolve is what the agent is
        // shown - the same list, and only that list, the decider computed.
        // "boss3" still resolves: a gateway echoing the caller's mentions
        // instead would show both, and `toMatchObject` on an array wants
        // equal length.
        const error = yield* call(
          "comms_post",
          { channel: "seniors", body: "still there?", mentions: ["boss1", "boss3"] },
          BOSS3,
        ).pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "CommsMemberNotFoundError", handles: ["boss1"] });
        const message = (error as { message: string }).message;
        expect(message).not.toContain(CHANNEL_ID);
        expect(message).not.toContain("Orchestration command invariant failed");
      }).pipe(
        Effect.provide(
          racedBy({
            type: "channel.member.remove",
            commandId: CommandId.make("cmd-remove-mentioned-raced"),
            channelId: CHANNEL_ID,
            handle: ChannelMemberHandle.make("boss1"),
          }),
        ),
      ),
    30_000,
  );

  it.effect(
    "says the channel was archived, by NAME, when it was archived between the check and the write",
    () =>
      Effect.gen(function* () {
        yield* seed();
        // The toolkit read `archivedAt: null`. The gateway's `ChannelArchived`
        // exists for exactly this: the toolkit's own archived check has
        // already passed, and the aggregate is the only thing left that can
        // say so. The agent is told the channel's NAME, which it knows, and
        // not its id, which it must not.
        const error = yield* call(
          "comms_post",
          { channel: "seniors", body: "last word" },
          BOSS3,
        ).pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "CommsChannelArchivedError", channel: "seniors" });
        const message = (error as { message: string }).message;
        expect(message).not.toContain(CHANNEL_ID);
        expect(message).not.toContain("Orchestration command invariant failed");
      }).pipe(
        Effect.provide(
          racedBy({
            type: "channel.archive",
            commandId: CommandId.make("cmd-archive-raced"),
            channelId: CHANNEL_ID,
          }),
        ),
      ),
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
    "refuses a cursor the SCHEMA should never have admitted",
    () =>
      Effect.gen(function* () {
        yield* seed();

        // `CURSOR_PATTERN` had no test at all. Deleting it outright - replacing
        // it with `/^[\s\S]*$/` - survived the whole suite, and so did
        // unbounding the digit half back to `[0-9]+`. Both bounds are argued at
        // length in its docstring and neither was ever measured.
        //
        // These reach the SCHEMA, not the gateway: a post id has no colon, and
        // a bare sequence has no channel half, so each is refused one layer
        // before `decodeCursor` ever runs.
        for (const notACursor of ["post-2", "3", "seniors:", "a:b:c", "  ", "9".repeat(16)]) {
          const refused = yield* call(
            "comms_read_channel",
            { channel: "seniors", cursor: notACursor },
            BOSS3,
          ).pipe(Effect.flip);
          expect(refused).toBeDefined();
          // Not a page. An empty page is what the old coercion produced and is
          // indistinguishable from "caught up".
          expect(refused).not.toMatchObject({ posts: [], nextCursor: null });
        }
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "tells the AGENT its cursor is foreign, and does not call it retryable",
    () =>
      Effect.gen(function* () {
        yield* seed();

        // SCHEMA-VALID AND STILL FOREIGN. That combination is the whole
        // fixture: every malformed cursor is refused by the tool schema one
        // layer up, so it never reaches the handler branch under test - which
        // is exactly how this half stayed untested while four mutations of it
        // passed the suite.
        //
        // IT CARRIES A DIRECTION because `t3_bot-2oh` added one to the format,
        // and the refusal under test is the one about PROVENANCE. A two-segment
        // value is admitted by the schema on purpose — the case below is about
        // that — and refused by the decoder as a shape failure, so dropping the
        // segment would still fail here, on a different branch, with a
        // different sentence, and the assertions below read the sentence.
        const foreign = "channel-project-live:forward:3";
        const error = yield* call(
          "comms_read_channel",
          { channel: "seniors", cursor: foreign },
          BOSS3,
        ).pipe(Effect.flip);

        // THE TAG IT IS, and the tag it MUST NOT BE. Folding this into
        // `CommsReadFailedError` survived every test, and that error is the
        // RETRYABLE one - so the agent would be told to try a cursor that can
        // never work, which is the looping instruction this whole area exists
        // to stop. Asserting only the tag it is would not have caught that.
        expect((error as { _tag: string })._tag).toBe("CommsCursorUnusableError");
        expect((error as { _tag: string })._tag).not.toBe("CommsReadFailedError");

        // NAMES THE CHANNEL THE AGENT ASKED FOR. Passing the wrong channel here
        // survived too, and an agent in several channels cannot act on a
        // refusal that names the wrong one.
        expect((error as unknown as { channel: string }).channel).toBe("seniors");
        const message = (error as { message: string }).message;
        expect(message).toContain("seniors");
        // AND IT SAYS THE TRUE THING ABOUT THIS CURSOR, which for this one is
        // that another channel issued it. The clause is asserted whole because
        // `toContain("seniors")` above passes for every sentence that mentions
        // the channel, including the one that blamed it wrongly (`t3_bot-2oh`).
        expect(message).toContain("That cursor was not issued by 'seniors'.");
        // AND IT SAYS WHAT TO DO. The message was replaceable with anything;
        // what an agent needs from it is the recovery, and the recovery has to
        // match the direction this tool actually reads.
        expect(message).toContain("without a cursor");
        // NOT the internal channel id, which the agent was never given.
        expect(message).not.toContain(CHANNEL_ID);

        // And a cursor this channel DID issue still pages, so the assertions
        // above are about provenance rather than about the tool refusing every
        // cursor.
        yield* call("comms_post", { channel: "seniors", body: "one" }, BOSS1);
        yield* call("comms_post", { channel: "seniors", body: "two" }, BOSS1);
        const first = yield* call("comms_read_channel", { channel: "seniors", limit: 1 }, BOSS3);
        const second = yield* call(
          "comms_read_channel",
          { channel: "seniors", limit: 1, cursor: first.nextCursor! },
          BOSS3,
        );
        expect(second.posts.map((post) => post.body)).toEqual(["two"]);

        // AND THE OTHER REFUSAL THIS CHANNEL CAN PRODUCE, through the live
        // decoder rather than a fake: the same cursor with its direction word
        // flipped. The channel half and the sequence are the gateway's own, so
        // provenance is not what is refused — and the sentence must not say it
        // is. THE FAKE CANNOT PROVE THIS. `handlers.test.ts` drives a double
        // that computes its own reason, so a decoder that named the wrong cause
        // would leave that file green; this is the only place the real word
        // becomes the prose an agent acts on.
        const otherDirection = first.nextCursor!.replace(":forward:", ":backward:");
        expect(otherDirection).not.toBe(first.nextCursor);
        const wrongWay = yield* call(
          "comms_read_channel",
          { channel: "seniors", cursor: otherDirection },
          BOSS3,
        ).pipe(Effect.flip);
        expect((wrongWay as { _tag: string })._tag).toBe("CommsCursorUnusableError");
        const wrongWayMessage = (wrongWay as { message: string }).message;
        expect(wrongWayMessage).toContain("in the other direction");
        expect(wrongWayMessage).not.toContain("was not issued by");
        expect(wrongWayMessage).toContain("without a cursor");
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "refuses a cursor issued before the direction existed, rather than assuming forward",
    () =>
      Effect.gen(function* () {
        yield* seed();
        const gateway = yield* ChannelGateway;
        for (const body of ["p1", "p2", "p3"]) {
          yield* call("comms_post", { channel: "seniors", body }, BOSS1);
        }

        // THE DEPLOY WINDOW, and it deserves its own case rather than a line in
        // a list, because the argument against it is strong: every cursor any
        // holder is carrying right now IS a forward cursor, since the only
        // issuer hardcodes forward — so "assume forward" would be right every
        // time and wrong never.
        //
        // Refused anyway. The assumption is unverifiable at the point of use:
        // the decoder cannot tell a toolkit-issued cursor from a hand-typed one
        // or, once a second caller chooses direction from the wire, from a
        // backward one. A guard that is correct only by appeal to a caller's
        // current behaviour is the defect class this bead exists for. A refusal
        // costs a re-read from the start; a wrong page costs the posts the
        // caller never learns it missed.
        const legacy = `${CHANNEL_ID}:2`;
        const refused = yield* gateway
          .readPosts({ channelId: CHANNEL_ID, limit: 10, cursor: legacy, direction: "forward" })
          .pipe(Effect.flip);
        expect(refused._tag).toBe("ChannelCursorUnusable");
        expect(refused).toMatchObject({
          cursor: legacy,
          channelId: CHANNEL_ID,
          reason: "malformed",
        });

        // AND THROUGH THE DOOR AN AGENT ACTUALLY USES, which is the half that
        // was wrong. `CURSOR_PATTERN` matched the encoder exactly, so this value
        // — one this server issued before the direction segment existed, and the
        // likeliest wrong cursor there is — never reached the gateway at all:
        // the tool schema turned it into an `AiError` quoting the regex, outside
        // the `CommsToolError` union this tool declares and with no recovery in
        // it. Measured, not assumed (`t3_bot-2oh`).
        const toolRefusal = yield* call(
          "comms_read_channel",
          { channel: "seniors", cursor: legacy },
          BOSS3,
        ).pipe(Effect.flip);
        expect((toolRefusal as { _tag: string })._tag).toBe("CommsCursorUnusableError");
        const legacyMessage = (toolRefusal as { message: string }).message;
        // THE RECOVERY IS THE PRODUCT. A schema refusal is still a refusal, so a
        // test reading only "it failed" cannot tell the two doors apart — which
        // is how the regex dump survived. This reads what the agent can act on.
        expect(legacyMessage).toContain("without a cursor");
        expect(legacyMessage).toContain("Nothing was lost.");
        expect(legacyMessage).not.toContain("RegExp");

        // And the same tree still pages with a cursor of the new shape, so this
        // is about the missing segment rather than about refusing everything.
        const page = yield* gateway.readPosts({
          channelId: CHANNEL_ID,
          limit: 2,
          cursor: undefined,
          direction: "forward",
        });
        expect(page.posts.map((post) => post.body)).toEqual(["p1", "p2"]);
        const next = yield* gateway.readPosts({
          channelId: CHANNEL_ID,
          limit: 2,
          cursor: page.nextCursor!,
          direction: "forward",
        });
        expect(next.posts.map((post) => post.body)).toEqual(["p3"]);
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "refuses a cursor from the OTHER DIRECTION instead of reporting it as caught up",
    () =>
      Effect.gen(function* () {
        yield* seed();
        const gateway = yield* ChannelGateway;

        // THE SAME LIE AS THE CHANNEL HALF, ONE AXIS OVER (`t3_bot-2oh`). A
        // cursor points AFTER its page going forward and BEFORE it going
        // backward, so the same number means opposite things; handed to the
        // other direction it named a window the caller had already read and the
        // read answered `nextCursor: null`, which is byte for byte "you are
        // caught up" over posts nobody had seen.
        //
        // SIX POSTS, FOR THE PAGING HALF BELOW, not for the refusal. Four
        // leaves the second page from each end touching a boundary — [p3,p4]
        // forward and [p1,p2] backward — while six makes both of them the same
        // MIDDLE pair, which is where an off-by-one at either end shows.
        //
        // The claim this comment used to make was that four posts hid the lie.
        // It was wrong, and it was mine: a review lane rewrote the test with
        // four and the mutant died anyway. Re-measured on this head — four
        // posts, direction guard intact: passes; guard removed: the same test
        // fails. The refusal half is killed by `Effect.flip` over a call that
        // now succeeds, and the window arithmetic never enters into it.
        for (const body of ["p1", "p2", "p3", "p4", "p5", "p6"]) {
          yield* call("comms_post", { channel: "seniors", body }, BOSS1);
        }

        const forward = yield* gateway.readPosts({
          channelId: CHANNEL_ID,
          limit: 2,
          cursor: undefined,
          direction: "forward",
        });
        expect(forward.posts.map((post) => post.body)).toEqual(["p1", "p2"]);
        const backward = yield* gateway.readPosts({
          channelId: CHANNEL_ID,
          limit: 2,
          cursor: undefined,
          direction: "backward",
        });
        expect(backward.posts.map((post) => post.body)).toEqual(["p5", "p6"]);

        // EACH CURSOR IN THE WRONG DIRECTION, refused. Measured before the fix:
        // the forward cursor read backward returned ["p1"] with nextCursor
        // null, leaving p3-p6 unread behind a "caught up"; the backward cursor
        // read forward returned ["p6"], leaving p1-p4 unread behind one.
        for (const [cursor, direction] of [
          [forward.nextCursor!, "backward"],
          [backward.nextCursor!, "forward"],
        ] as const) {
          const refused = yield* gateway
            .readPosts({ channelId: CHANNEL_ID, limit: 10, cursor, direction })
            .pipe(Effect.flip);
          expect(refused._tag).toBe("ChannelCursorUnusable");
          // The payload carries what the caller SENT, never this channel's own
          // position — the same rule the foreign-cursor refusal follows.
          expect(refused).toMatchObject({ cursor, channelId: CHANNEL_ID });
        }

        // AND BOTH DIRECTIONS STILL PAGE WITH THEIR OWN CURSORS, which is what
        // separates this from a guard that refuses every cursor. Without these
        // four assertions the two refusals above are satisfied by
        // `readPosts` failing unconditionally, and paging would be broken in
        // exactly the way nothing else here would notice.
        const forwardNext = yield* gateway.readPosts({
          channelId: CHANNEL_ID,
          limit: 2,
          cursor: forward.nextCursor!,
          direction: "forward",
        });
        expect(forwardNext.posts.map((post) => post.body)).toEqual(["p3", "p4"]);
        const backwardNext = yield* gateway.readPosts({
          channelId: CHANNEL_ID,
          limit: 2,
          cursor: backward.nextCursor!,
          direction: "backward",
        });
        expect(backwardNext.posts.map((post) => post.body)).toEqual(["p3", "p4"]);
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "refuses a cursor from another channel instead of reporting it as caught up",
    () =>
      Effect.gen(function* () {
        yield* seed();
        const gateway = yield* ChannelGateway;

        // THE DEFECT THIS BEAD EXISTS FOR. The cursor used to be the bare
        // global event sequence, so one earned in another channel was
        // well-formed digits matching no row here - and the read came back as
        // an empty page with `nextCursor: null`, which is byte for byte what
        // "you are caught up" looks like. The caller cannot tell those apart,
        // so it stops reading a channel that has unread posts in it.
        //
        // EVERY FIXTURE CARRIES A DIRECTION, and that is not decoration. When
        // the direction segment was added (`t3_bot-2oh`) every value here was
        // two-segment, so the decoder refused them all at the direction
        // boundary BEFORE the provenance clause this test exists to measure.
        // The test stayed green and stopped testing: a QA lane re-ran the
        // mutants and found three that the base suite killed — the digit
        // pre-check, the exact channel compare, and the safe-integer check —
        // surviving at head. Nobody edited a test; a source change defanged the
        // fixtures underneath them.
        for (const foreign of [
          "channel-somewhere-else:forward:3",
          "not-a-cursor",
          `${CHANNEL_ID}:forward:abc`,
          `${CHANNEL_ID}:forward:-1`,
          `${CHANNEL_ID}:forward:1.5`,
          `${CHANNEL_ID}:forward:9007199254740993`,
          "3",
          // THE TWO THAT SEPARATE AN EXACT COMPARISON FROM A LAZY ONE, and
          // without them the other six do not. Every value above differs from
          // this channel in LENGTH and in PREFIX, so `from !== channelId`,
          // `from.length !== channelId.length` and `!channelId.startsWith(from)`
          // are the same function against them - two of those were run as
          // mutants and survived every test in this file.
          //
          // It is not hypothetical arithmetic: `HierarchySeeder` mints
          // `channel-project` and `channel-seniors`, both fifteen characters
          // and both starting "channel-". Under a length comparison a real
          // cursor from one pages the other on a seeded install, which is the
          // defect this whole test exists to close.
          `${CHANNEL_ID.slice(0, -1)}:forward:3`,
          `${CHANNEL_ID.replace("seniors", "project")}:forward:3`,
        ]) {
          // `Effect.flip` rather than `exit`: this must be a typed FAILURE, so
          // flipping yields the error as a value and a defect would propagate
          // and fail the test instead - which is the distinction being made.
          const refused = yield* gateway
            .readPosts({ channelId: CHANNEL_ID, limit: 10, cursor: foreign, direction: "forward" })
            .pipe(Effect.flip);
          expect(refused._tag).toBe("ChannelCursorUnusable");
          // AND THE PAYLOAD, because a tag-only assertion let the two fields be
          // swapped and let the refusal echo a synthesised EXPECTED cursor -
          // the disclosure its own docstring forbids. It carries what the
          // caller SENT and the channel asked about, never this channel's own
          // position.
          expect(refused).toMatchObject({ cursor: foreign, channelId: CHANNEL_ID });
        }

        // And this channel's OWN cursor still works, so the assertions above
        // are about provenance rather than about readPosts refusing every
        // cursor - which would satisfy all six and break paging.
        for (const body of ["first", "second", "third"]) {
          yield* call("comms_post", { channel: "seniors", body }, BOSS1);
        }
        const page = yield* gateway.readPosts({
          channelId: CHANNEL_ID,
          limit: 2,
          cursor: undefined,
          direction: "forward",
        });
        expect(page.posts.map((post) => post.body)).toEqual(["first", "second"]);
        expect(page.nextCursor).not.toBeNull();
        const next = yield* gateway.readPosts({
          channelId: CHANNEL_ID,
          limit: 2,
          cursor: page.nextCursor!,
          direction: "forward",
        });
        expect(next.posts.map((post) => post.body)).toEqual(["third"]);

        // BACKWARD opens on the newest page and still returns it ascending.
        const newest = yield* gateway.readPosts({
          channelId: CHANNEL_ID,
          limit: 2,
          cursor: undefined,
          direction: "backward",
        });
        expect(newest.posts.map((post) => post.body)).toEqual(["second", "third"]);
        // Its cursor points BEFORE the oldest row returned, so the next page
        // going backward is older still.
        const older = yield* gateway.readPosts({
          channelId: CHANNEL_ID,
          limit: 2,
          cursor: newest.nextCursor!,
          direction: "backward",
        });
        expect(older.posts.map((post) => post.body)).toEqual(["first"]);
        expect(older.nextCursor).toBeNull();
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "refuses every sequence `Number()` would have invented a number for",
    () =>
      Effect.gen(function* () {
        yield* seed();
        const gateway = yield* ChannelGateway;

        // THIS PROPERTY WAS LOST IN A SPLIT, which is the fourth time work of
        // mine has removed a test on this branch and the first time it happened
        // without a line being deleted. The base test asserted four things;
        // three became their own tests and this one did not, and its own
        // comment had predicted exactly that - "without it the guard is inert".
        //
        // The digit pre-check in `decodeCursor` is what these measure, and
        // nothing else in the suite reaches it. Every malformed cursor
        // elsewhere is caught by a DIFFERENT clause: `:abc` by
        // `Number.isSafeInteger(NaN)`, `:-1` by `sequence < 0`, `:1.5` and the
        // 16-digit one by `isSafeInteger`. Delete the pre-check and all of
        // those still refuse - which is how a guard I added on this branch sat
        // in the tree with no test that could tell whether it was there.
        //
        // Every value here carries THIS channel's id, so the provenance clause
        // passes and the digit check is the only thing left that can refuse
        // them. `Number()` reads each one as a perfectly good non-negative safe
        // integer - 0, 2, 3, 100, 4, 3 - so without the pre-check the read
        // answers with a page starting at a sequence the caller never asked
        // for, which is the silent wrong answer this bead exists to end.
        //
        // AND A DIRECTION ON EACH, for the reason above: two-segment values are
        // refused at the direction boundary, so without it the sentence
        // directly above this loop — "the digit check is the only thing left
        // that can refuse them" — is false, and deleting the digit check leaves
        // this test green. Measured by a QA lane, not reasoned about.
        for (const coercible of [
          `${CHANNEL_ID}:forward:`,
          `${CHANNEL_ID}:forward:0x2`,
          `${CHANNEL_ID}:forward: 3 `,
          `${CHANNEL_ID}:forward:1e2`,
          `${CHANNEL_ID}:forward:+4`,
          `${CHANNEL_ID}:forward:0b11`,
        ]) {
          // A typed failure, so `flip` rather than `exit`: a defect would
          // propagate and fail the test instead of being yielded, which is the
          // distinction these cursors are about.
          const refused = yield* gateway
            .readPosts({
              channelId: CHANNEL_ID,
              limit: 10,
              cursor: coercible,
              direction: "forward",
            })
            .pipe(Effect.flip);
          expect(refused._tag).toBe("ChannelCursorUnusable");
          expect(refused).toMatchObject({ cursor: coercible, channelId: CHANNEL_ID });
        }

        // And a plain digit cursor still pages, so the loop above is about what
        // `Number()` accepts rather than about the guard refusing everything -
        // a refusal of every sequence satisfies all six and breaks reading.
        for (const body of ["first", "second"]) {
          yield* call("comms_post", { channel: "seniors", body }, BOSS1);
        }
        const page = yield* gateway.readPosts({
          channelId: CHANNEL_ID,
          limit: 1,
          cursor: undefined,
          direction: "forward",
        });
        const next = yield* gateway.readPosts({
          channelId: CHANNEL_ID,
          limit: 1,
          cursor: page.nextCursor!,
          direction: "forward",
        });
        expect(next.posts.map((post) => post.body)).toEqual(["second"]);
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "gives a read no member field to carry, and refuses a channel the caller is not in",
    () =>
      Effect.gen(function* () {
        yield* seed();
        const engine = yield* OrchestrationEngineService;

        // A SECOND CHANNEL THAT BOSS3 IS NOT IN. My first version of this test
        // used #seniors - which BOSS3 is already a member of - so a handler
        // reading as an agent-supplied member returned the SAME ANSWER as one
        // reading as the credential. It could not fail, and a security lane
        // proved a member-smuggling handler survives the whole suite against
        // it.
        //
        // The property needs a channel where the two answers WOULD differ:
        // reading as the credential must refuse, and reading as a smuggled
        // member would succeed. That much was right. What was still missing is
        // below, and it is that there is no smuggling channel at all.
        const privateId = ChannelId.make("channel-boss1-only");
        yield* engine.dispatch(
          {
            type: "channel.create",
            commandId: CommandId.make("cmd-channel-private"),
            channelId: privateId,
            name: "boss1-only",
            members: [
              { handle: ChannelMemberHandle.make("boss1"), memberKind: "thread", memberId: BOSS1 },
            ],
            createdAt: NOW,
          },
          { issuer: ADMIN },
        );

        // WHERE THE SECOND VERSION OF THIS TEST WAS STILL WRONG, and a blind
        // verifier proved it rather than argued it: passing `memberId` and
        // `memberKind` in the arguments smuggles NOTHING, because the tool's
        // param schema does not declare them and the toolkit strips them during
        // decode. The handler's input is `{ channel: "boss1-only" }`. The
        // verifier built the impersonating handler this was supposed to catch -
        // `requireChannel` threaded with `input.memberId` - and it passed 61/61.
        // The refusal below is satisfied by BOSS3 simply not being a member,
        // with or without the credential rule.
        //
        // So the ARGUMENTS ARE GONE and what is asserted instead is the control
        // that actually holds: there is no member field on the wire for a
        // handler to read. Add one to `ReadChannelTool`'s parameters and this
        // reds; that is a property of the schema, which is where the defence
        // lives, rather than of a call that could never have carried anything.
        const readParams = Object.keys(
          (
            CommsToolkit.tools.comms_read_channel.parametersSchema as unknown as {
              fields: Record<string, unknown>;
            }
          ).fields,
        );
        expect(readParams.sort()).toEqual(["channel", "cursor", "limit"]);

        const refused = yield* call("comms_read_channel", { channel: "boss1-only" }, BOSS3).pipe(
          Effect.flip,
        );
        expect((refused as { _tag: string })._tag).toBe("CommsChannelNotFoundError");

        // And BOSS1 reading its own channel succeeds, so the refusal above is
        // about WHO ASKED rather than the channel being unreachable.
        const allowed = yield* call("comms_read_channel", { channel: "boss1-only" }, BOSS1);
        expect(allowed.channel).toBe("boss1-only");

        // The constructors carry their SOURCE, both fields each. Asserting the
        // id alone passes against one that hardcodes the wrong kind.
        const fromCredential = refFromMcpCredential(invocation(BOSS3));
        expect(fromCredential.memberKind).toBe("thread");
        expect(fromCredential.memberId).toBe(BOSS3);
        const fromSession = refFromOperatorSession();
        expect(fromSession.memberKind).toBe("human");
        expect(fromSession.memberId).toBe(HUMAN_OPERATOR_MEMBER_ID);
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "reports a malformed channel id rather than throwing while being called",
    () =>
      Effect.gen(function* () {
        yield* seed();
        const gateway = yield* ChannelGateway;

        // `Effect.exit` can only produce an Exit VALUE if the Effect was built
        // at all. A throw while the function is being CALLED never reaches it
        // and fails the test uncatchably instead - which looks identical in a
        // summary line, so an assertion that only checks THAT it failed cannot
        // tell the two apart. That distinction is the whole of what the
        // `Effect.suspend` buys.
        //
        // What comes back is a DEFECT, not a typed failure: a Failure whose
        // cause is a Die. `getPost` declares only `ChannelStoreUnavailable`, so
        // a malformed id is still a caller bug - the suspend makes the bug
        // reportable rather than escaping.
        const unbrandable = yield* gateway.getPost("not a channel id", "post-1").pipe(Effect.exit);
        expect(unbrandable._tag).toBe("Failure");
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "honours createPost's declared failures on a parent id the brand refuses",
    () =>
      Effect.gen(function* () {
        yield* seed();
        const gateway = yield* ChannelGateway;

        // `createPost` declares five typed failures. A malformed parent used to
        // come out as a raw schema Die carrying a serialised AST, so a caller
        // writing an exhaustive `catchTags` would look correct and be wrong.
        // The toolkit never reaches it - `comms_reply` resolves the parent
        // first - which is exactly why nothing tested it until it was broken.
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
          // THE TAG, because `Effect.flip` cannot tell a typed refusal from a
          // defect - it propagates a die rather than yielding it as a value.
          expect(String(refused)).toContain("ChannelWriteConflict");
          expect(String(refused)).not.toContain("SchemaIssue");
        }
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "refuses a whitespace-only mention typed, which is NOT the same site",
    () =>
      Effect.gen(function* () {
        yield* seed();
        const gateway = yield* ChannelGateway;

        // `ChannelMemberHandle` is a trimmed non-empty string, so a handle of
        // only whitespace LOOKS like it should throw the way the ids did. It
        // does not: `.make` checks `isNonEmpty` against the UNTRIMMED value,
        // which has length 3, so it constructs - and the DECIDER refuses it by
        // canonicalising. The result is a typed `ChannelWriteConflict`.
        //
        // Not provenance and not luck: a chain of three non-obvious facts. A
        // defect appearing here later means one of them changed.
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
    "tells a THREAD member from a HUMAN member carrying the same id",
    () =>
      Effect.gen(function* () {
        yield* seed();
        const channels = yield* ProjectionChannelRepository;

        // THE COLLIDING ROSTER, shared (`orchestration/testing/collidingRoster.ts`),
        // written into the projection here because this test is about the
        // gateway's READ and does not need the engine. The module carries the
        // account of why the roster exists and how it arrives: this comment
        // used to say the aggregate refuses the shape, #24 overturned that (it
        // was reachable by ordering), and `t3_bot-7iw` made it true again —
        // the roster arrives by replay of rows written before the guard, which
        // is the path this projection write models.
        //
        // ORDER IS NOT THE MEASUREMENT HERE. `getChannelForMember` is a boolean
        // `some` over the roster and returns the channel, never the row, so with
        // both rows seated either order answers Some for both refs under an
        // id-only comparison too. The measurement is the impostor phase below:
        // the thread row ALONE, asked about by the human ref. Delete that phase
        // and the id-only mutant survives.
        const roster = collidingMembers({
          humanHandle: ChannelMemberHandle.make("walt"),
          threadHandle: ChannelMemberHandle.make("ghost"),
          first: "thread",
        });
        yield* channels.replaceMembers({ channelId: CHANNEL_ID, members: roster });

        const gateway = yield* ChannelGateway;
        // Both kinds are seated, so both refs must resolve to the channel: the
        // admit side, which an inert comparison fails and which the negative
        // below cannot prove on its own.
        const asHuman = yield* gateway.getChannelForMember("seniors", COLLIDING_HUMAN_REF);
        const asThread = yield* gateway.getChannelForMember("seniors", COLLIDING_THREAD_REF);
        expect(Option.isSome(asHuman)).toBe(true);
        expect(Option.isSome(asThread)).toBe(true);

        // AND THE KIND THAT IS NOT IN THE ROSTER IS REFUSED, which is the half
        // that fails when `memberKind` is dropped from the comparison: the id
        // matches, so an id-only check admits a member that is not there.
        yield* channels.replaceMembers({
          channelId: CHANNEL_ID,
          members: roster.filter((member) => member.memberKind === "thread"),
        });
        const impostor = yield* gateway.getChannelForMember("seniors", COLLIDING_HUMAN_REF);
        expect(Option.isNone(impostor)).toBe(true);
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
        const defect = yield* gateway
          .getChannelForMember("#Seniors", unsafeRefForTest("thread", BOSS3))
          .pipe(Effect.exit);
        expect(defect._tag).toBe("Failure");
        expect(String(defect)).toContain("non-canonical name");

        // The canonical form of the same name resolves, so the assertion above
        // is about the FORM rather than about the channel being absent.
        const found = yield* gateway.getChannelForMember(
          "seniors",
          unsafeRefForTest("thread", BOSS3),
        );
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
        // distinct branches two lines apart. THE MISSING-CHANNEL BRANCH IS THE
        // ONE THAT HAD NOTHING: the three tests that pinned this property all
        // made a NON-MEMBER call, so no test anywhere made a missing-channel
        // call and nothing could see that branch change at all. Measured by
        // deleting the comparison below and re-running each mutant - the
        // non-member side still reds, because a mutation there changes the tag
        // the older assertions already check; the missing side goes fully green,
        // 67 passed. So this line is the only thing in the repository that
        // catches it (`t3_bot-glu`).
        //
        // The non-member side is less exposed than that reads: a mutation there
        // which PRESERVED the tag would need the gateway to return something
        // richer than `Option<Channel>`, which is a larger change than the one
        // this guards.
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
