import { NodeServices } from "@effect/platform-node";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  OrchestrationEventType,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../../config.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { ChannelPostWakeRepository } from "../../persistence/Services/ChannelPostWakes.ts";
import { ProjectionDecoderRepository } from "../../persistence/Services/ProjectionDecoder.ts";
import { ProjectionProjectRepository } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionStateRepository } from "../../persistence/Services/ProjectionState.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import {
  ORCHESTRATION_PROJECTOR_NAMES,
  OrchestrationProjectionPipelineLive,
} from "./ProjectionPipeline.ts";

// A build that decodes a type an older build skipped must find the hole and
// rebuild (t3_bot-n33f). The older build cannot run in this process, so its
// footprint is written by hand where the pipeline would have left it: a
// decoder epoch whose lists lack a type, over the watermark range it applied,
// and a row of that type inside the range. This build then boots.
const now = "2026-01-01T00:00:00.000Z";

const layer = it.layer(
  OrchestrationProjectionPipelineLive.pipe(
    Layer.provideMerge(OrchestrationEventStoreLive),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-projection-rebuild-" })),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  ),
);

const projectCreated = (projectId: ProjectId, id: string) =>
  ({
    type: "project.created",
    eventId: EventId.make(id),
    aggregateKind: "project",
    aggregateId: projectId,
    occurredAt: now,
    commandId: CommandId.make(`cmd-${id}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: {
      projectId,
      title: `Project ${projectId}`,
      workspaceRoot: `/tmp/${projectId}`,
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  }) as const;

const threadCreated = (projectId: ProjectId, threadId: ThreadId, id: string) =>
  ({
    type: "thread.created",
    eventId: EventId.make(id),
    aggregateKind: "thread",
    aggregateId: threadId,
    occurredAt: now,
    commandId: CommandId.make(`cmd-${id}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: {
      threadId,
      projectId,
      title: `Thread ${threadId}`,
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  }) as const;

// A payload the thread projector accepts, written as the JSON the older build
// would have stored for a type it could not name. It is a string literal, not
// a serialiser call, so the repo's schema-over-JSON rule is kept.
const threadCreatedPayloadJson = (projectId: string, threadId: string) =>
  `{"threadId":"${threadId}","projectId":"${projectId}","title":"Thread ${threadId}","modelSelection":{"instanceId":"codex","model":"gpt-5"},"runtimeMode":"full-access","interactionMode":"default","branch":null,"worktreePath":null,"createdAt":"${now}","updatedAt":"${now}"}`;

function insertRawEventRow(
  sql: SqlClient.SqlClient,
  row: {
    readonly eventId: string;
    readonly aggregateKind: string;
    readonly aggregateId: string;
    readonly eventType: string;
    readonly payloadJson: string;
  },
) {
  return sql<{ readonly sequence: number }>`
    INSERT INTO orchestration_events (
      event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
      actor_kind, payload_json, metadata_json
    ) VALUES (
      ${row.eventId}, ${row.aggregateKind}, ${row.aggregateId}, ${1},
      ${row.eventType}, ${now}, ${"server"}, ${row.payloadJson}, ${"{}"}
    )
    RETURNING sequence
  `.pipe(Effect.map((rows) => rows[0]!.sequence));
}

const projectedThreadIds = (sql: SqlClient.SqlClient) =>
  sql<{ readonly threadId: string }>`
    SELECT thread_id AS "threadId" FROM projection_threads ORDER BY thread_id ASC
  `.pipe(Effect.map((rows) => rows.map((row) => row.threadId)));

// A row no event produces, written through the projects repository so the
// column set is the repository's. A rebuild empties the table and the row is
// gone; a bootstrap that did not rebuild leaves it standing.
const markerProjectId = ProjectId.make("project-marker");

const plantMarkerProject = Effect.gen(function* () {
  const projects = yield* ProjectionProjectRepository;
  yield* projects.upsert({
    projectId: markerProjectId,
    title: "marker",
    workspaceRoot: "/tmp/marker",
    defaultModelSelection: null,
    defaultThreadEnvMode: null,
    autoPull: false,
    scripts: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
});

const markerProjectStands = (sql: SqlClient.SqlClient) =>
  sql<{ readonly count: number }>`
    SELECT COUNT(*) AS "count" FROM projection_projects WHERE project_id = ${markerProjectId}
  `.pipe(Effect.map((rows) => rows[0]!.count === 1));

const projectorWatermarks = Effect.gen(function* () {
  const states = yield* (yield* ProjectionStateRepository).listAll();
  return Object.values(ORCHESTRATION_PROJECTOR_NAMES).map(
    (name) => states.find((state) => state.projector === name)?.lastAppliedSequence ?? 0,
  );
});

// The older build's footprint: an epoch whose lists lack `missingType`, over
// (startedAt, endedAt]. Written directly because that build cannot run here.
const writeOlderEpoch = (
  sql: SqlClient.SqlClient,
  input: { readonly missingType: string; readonly startedAt: number; readonly endedAt: number },
) =>
  Effect.gen(function* () {
    const decoder = yield* ProjectionDecoderRepository;
    yield* sql`DELETE FROM projection_decoder`;
    yield* decoder.appendEpoch({
      eventTypes: OrchestrationEventType.literals.filter((type) => type !== input.missingType),
      aggregateKinds: ["project", "thread", "channel"],
      startedAtSequence: input.startedAt,
      endedAtSequence: input.endedAt,
    });
  });

layer("OrchestrationProjectionPipeline decoder hole", (it) => {
  it.effect("rebuilds every projector when a type it decodes sits inside an older epoch", () =>
    Effect.gen(function* () {
      const pipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const decoder = yield* ProjectionDecoderRepository;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project-hole");
      const skippedThread = ThreadId.make("thread-skipped");
      const laterThread = ThreadId.make("thread-later");

      // What the older build saw: 1 known, 2 a type outside its union, 3 known.
      yield* eventStore.append(projectCreated(projectId, "evt-hole-project"));
      const skipped = yield* insertRawEventRow(sql, {
        eventId: "evt-hole-skipped",
        aggregateKind: "thread",
        aggregateId: skippedThread,
        eventType: "project.future-event",
        payloadJson: '{"future":true}',
      });
      const later = yield* eventStore.append(
        threadCreated(projectId, laterThread, "evt-hole-later"),
      );

      yield* pipeline.bootstrap;
      assert.deepEqual(yield* projectedThreadIds(sql), [laterThread]);
      assert.isTrue((yield* projectorWatermarks).every((sequence) => sequence === later.sequence));
      // The ledger recorded this build's lists over the range it applied.
      const recorded = yield* decoder.listEpochs();
      assert.equal(recorded.length, 1);
      assert.deepEqual(
        [...recorded[0]!.eventTypes].sort(),
        [...OrchestrationEventType.literals].sort(),
      );
      assert.equal(recorded[0]!.startedAtSequence, 0);
      assert.equal(recorded[0]!.endedAtSequence, later.sequence);

      // Now this process stands in for the newer build: the row at 2 is a type
      // it decodes, and the ledger says the build that set the watermark could
      // not. A marker row shows whether the tables were emptied.
      yield* sql`
        UPDATE orchestration_events
        SET event_type = ${"thread.created"}, payload_json = ${threadCreatedPayloadJson(projectId, skippedThread)}
        WHERE sequence = ${skipped}
      `;
      yield* writeOlderEpoch(sql, {
        missingType: "thread.created",
        startedAt: 0,
        endedAt: later.sequence,
      });
      yield* plantMarkerProject;
      // A capture row a projector writes with a plain INSERT: a rebuild that
      // kept it would collide with the replay's own insert, so it must go too.
      yield* (yield* ChannelPostWakeRepository).link({
        channelId: "channel-marker",
        postId: "post-marker",
        threadId: laterThread,
        turnId: TurnId.make("turn-marker"),
        linkedAt: now,
      });

      yield* pipeline.bootstrap;

      assert.deepEqual(yield* projectedThreadIds(sql), [laterThread, skippedThread]);
      assert.isFalse(yield* markerProjectStands(sql));
      const wakeRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS "count" FROM channel_post_wake
      `.pipe(Effect.map((rows) => rows[0]!.count));
      assert.equal(wakeRows, 0);
      assert.isTrue((yield* projectorWatermarks).every((sequence) => sequence === later.sequence));
      // The older epochs are gone and this build's epoch covers the whole log.
      const epochs = yield* decoder.listEpochs();
      assert.equal(epochs.length, 1);
      assert.equal(epochs[0]!.startedAtSequence, 0);
      assert.equal(epochs[0]!.endedAtSequence, later.sequence);
      assert.isTrue(epochs[0]!.eventTypes.includes("thread.created"));
    }),
  );
});

layer("OrchestrationProjectionPipeline decoder unchanged", (it) => {
  it.effect("does not rebuild when the ledger already carries this build's lists", () =>
    Effect.gen(function* () {
      const pipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const decoder = yield* ProjectionDecoderRepository;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project-steady");
      const threadId = ThreadId.make("thread-steady");

      yield* eventStore.append(projectCreated(projectId, "evt-steady-project"));
      const created = yield* eventStore.append(
        threadCreated(projectId, threadId, "evt-steady-thread"),
      );
      yield* pipeline.bootstrap;
      yield* plantMarkerProject;

      yield* pipeline.bootstrap;

      // The marker survives: nothing was emptied. The epoch was extended, not
      // duplicated, so a build that boots daily does not grow the ledger.
      assert.isTrue(yield* markerProjectStands(sql));
      assert.deepEqual(yield* projectedThreadIds(sql), [threadId]);
      const epochs = yield* decoder.listEpochs();
      assert.equal(epochs.length, 1);
      assert.equal(epochs[0]!.endedAtSequence, created.sequence);
    }),
  );
});

layer("OrchestrationProjectionPipeline trailing skipped row", (it) => {
  it.effect("does not rebuild for a skipped row the watermark never crossed", () =>
    Effect.gen(function* () {
      const pipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project-trailing");
      const trailingThread = ThreadId.make("thread-trailing");

      // The older build applied 1 and stopped; the skipped row at 2 is the
      // tail of the log, so its watermark stayed at 1 and its epoch ends there.
      const first = yield* eventStore.append(projectCreated(projectId, "evt-trailing-project"));
      const skipped = yield* insertRawEventRow(sql, {
        eventId: "evt-trailing-skipped",
        aggregateKind: "thread",
        aggregateId: trailingThread,
        eventType: "project.future-event",
        payloadJson: '{"future":true}',
      });
      yield* pipeline.bootstrap;
      assert.isTrue((yield* projectorWatermarks).every((sequence) => sequence === first.sequence));

      yield* sql`
        UPDATE orchestration_events
        SET event_type = ${"thread.created"}, payload_json = ${threadCreatedPayloadJson(projectId, trailingThread)}
        WHERE sequence = ${skipped}
      `;
      yield* writeOlderEpoch(sql, {
        missingType: "thread.created",
        startedAt: 0,
        endedAt: first.sequence,
      });
      yield* plantMarkerProject;

      yield* pipeline.bootstrap;

      // Not a hole: the ordinary resume from 1 applies row 2. No rebuild, so
      // the marker stands.
      assert.deepEqual(yield* projectedThreadIds(sql), [trailingThread]);
      assert.isTrue(yield* markerProjectStands(sql));
      assert.isTrue((yield* projectorWatermarks).every((sequence) => sequence === skipped));
    }),
  );
});

layer("OrchestrationProjectionPipeline downgrade then upgrade", (it) => {
  it.effect("finds a hole in the older build's epoch when the newer build returns", () =>
    Effect.gen(function* () {
      const pipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const decoder = yield* ProjectionDecoderRepository;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project-downgrade");
      const early = ThreadId.make("thread-early");
      const holeThread = ThreadId.make("thread-hole");
      const late = ThreadId.make("thread-late");

      // Epoch 1, this build: 1 project, 2 thread.created, applied and recorded.
      yield* eventStore.append(projectCreated(projectId, "evt-down-project"));
      const earlyEvent = yield* eventStore.append(
        threadCreated(projectId, early, "evt-down-early"),
      );
      yield* pipeline.bootstrap;

      // Epoch 2, an older build that lacks thread.created: it skipped 3 and
      // applied a known 4, moving every watermark to 4. Written by hand.
      const skipped = yield* insertRawEventRow(sql, {
        eventId: "evt-down-hole",
        aggregateKind: "thread",
        aggregateId: holeThread,
        eventType: "thread.created",
        payloadJson: threadCreatedPayloadJson(projectId, holeThread),
      });
      const lateEvent = yield* eventStore.append(threadCreated(projectId, late, "evt-down-late"));
      yield* decoder.appendEpoch({
        eventTypes: OrchestrationEventType.literals.filter((type) => type !== "thread.created"),
        aggregateKinds: ["project", "thread", "channel"],
        startedAtSequence: earlyEvent.sequence,
        endedAtSequence: lateEvent.sequence,
      });
      yield* (yield* ProjectionStateRepository).upsertMany(
        Object.values(ORCHESTRATION_PROJECTOR_NAMES).map((projector) => ({
          projector,
          lastAppliedSequence: lateEvent.sequence,
          updatedAt: now,
        })),
      );
      // The older build applied 4 itself on its own tables; here only `early`
      // is projected, and the point is that 3 is applied after the rebuild.
      assert.deepEqual(yield* projectedThreadIds(sql), [early]);

      // Epoch 3: this build returns. Its lists exceed epoch 2's, and the
      // scan of epoch 2's range (2, 4] finds sequence 3.
      yield* pipeline.bootstrap;

      assert.deepEqual(yield* projectedThreadIds(sql), [early, holeThread, late]);
      assert.isTrue(
        (yield* projectorWatermarks).every((sequence) => sequence === lateEvent.sequence),
      );
      const epochs = yield* decoder.listEpochs();
      assert.equal(epochs.length, 1);
      assert.equal(epochs[0]!.startedAtSequence, 0);
      assert.isTrue(skipped > earlyEvent.sequence && skipped <= lateEvent.sequence);
    }),
  );
});

layer("OrchestrationProjectionPipeline earlier epoch applied", (it) => {
  it.effect("does not rebuild for a row an earlier epoch applied before the older build ran", () =>
    Effect.gen(function* () {
      const pipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const decoder = yield* ProjectionDecoderRepository;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project-applied");
      const threadId = ThreadId.make("thread-applied");

      // Epoch 1, this build: 1 project, 2 thread.created, applied.
      yield* eventStore.append(projectCreated(projectId, "evt-applied-project"));
      const applied = yield* eventStore.append(
        threadCreated(projectId, threadId, "evt-applied-thread"),
      );
      yield* pipeline.bootstrap;

      // Epoch 2, an older build that lacks thread.created, applied only a
      // known 3 over (2, 3]: no row of the missing type inside its range.
      const known = yield* eventStore.append(
        projectCreated(ProjectId.make("project-applied-2"), "evt-applied-project-2"),
      );
      yield* decoder.appendEpoch({
        eventTypes: OrchestrationEventType.literals.filter((type) => type !== "thread.created"),
        aggregateKinds: ["project", "thread", "channel"],
        startedAtSequence: applied.sequence,
        endedAtSequence: known.sequence,
      });
      yield* (yield* ProjectionStateRepository).upsertMany(
        Object.values(ORCHESTRATION_PROJECTOR_NAMES).map((projector) => ({
          projector,
          lastAppliedSequence: known.sequence,
          updatedAt: now,
        })),
      );
      yield* plantMarkerProject;

      yield* pipeline.bootstrap;

      // The thread.created at 2 was applied by epoch 1, before the older
      // build ran; a scan that ignored the epoch's start would rebuild for
      // it. The marker stands, so nothing was emptied.
      assert.isTrue(yield* markerProjectStands(sql));
      assert.deepEqual(yield* projectedThreadIds(sql), [threadId]);
      assert.equal((yield* decoder.listEpochs()).length, 3);
    }),
  );
});
