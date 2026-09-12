import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
  operatorCommandIssuer,
  refFromOperatorSession,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { projectThreadDetailSnapshot } from "./ActivityPayloadProjection.ts";
import { readChannelPostPage } from "./channelPosts.ts";
import { withMemberChannels } from "./channelShell.ts";
import { cleanupFailedUploadedAttachments, normalizeDispatchCommand } from "./Normalizer.ts";
import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentInvalidRequest,
  failEnvironmentNotFound,
  requireEnvironmentScope,
} from "../auth/http.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

export const orchestrationHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "orchestration",
  Effect.fnUntraced(function* (handlers) {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationEngine = yield* OrchestrationEngineService;

    return handlers
      .handle(
        "snapshot",
        Effect.fn("environment.orchestration.snapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          // Serve the lightweight command read model (thread bodies empty)
          // instead of the fully hydrated snapshot. Hydrating every message
          // and activity payload in the database has OOM-killed servers, and
          // the route's only consumer (the project CLI) reads projects alone —
          // UI clients load the shell and per-thread snapshots instead.
          return yield* projectionSnapshotQuery
            .getCommandReadModel()
            .pipe(
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_snapshot_failed", cause),
              ),
            );
        }),
      )
      .handle(
        "shellSnapshot",
        Effect.fn("environment.orchestration.shellSnapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          // WITH THE OPERATOR'S CHANNELS. This is the route a browser actually
          // bootstraps its shell from, and it then resumes the socket by
          // sequence — so a snapshot without channels here is a sidebar that
          // stays empty no matter what the live stream does. Same function as
          // the socket's snapshot path, so the two cannot answer differently.
          return yield* projectionSnapshotQuery.getShellSnapshot().pipe(
            Effect.flatMap((snapshot) =>
              withMemberChannels({ snapshot, member: refFromOperatorSession() }),
            ),
            Effect.catch((cause) =>
              failEnvironmentInternal("orchestration_snapshot_failed", cause),
            ),
          );
        }),
      )
      .handle(
        "threadSnapshot",
        Effect.fn("environment.orchestration.threadSnapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const snapshot = yield* projectionSnapshotQuery
            .getThreadDetailSnapshot(
              args.params.threadId,
              args.payload.turnLimit === undefined
                ? undefined
                : {
                    turnLimit: args.payload.turnLimit,
                    ...(args.payload.beforeCursor !== undefined
                      ? { beforeCursor: args.payload.beforeCursor }
                      : {}),
                  },
            )
            .pipe(
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_thread_snapshot_failed", cause),
              ),
            );
          if (Option.isNone(snapshot)) {
            return yield* failEnvironmentNotFound("thread_not_found");
          }
          return projectThreadDetailSnapshot(snapshot.value);
        }),
      )
      .handle(
        "channelPosts",
        Effect.fn("environment.orchestration.channelPosts")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          // DECODE, CALL, TRANSLATE. Membership, the cursor's channel half, the
          // over-fetch and which end the extra row comes off are all in
          // `readChannelPostPage`, shared with the socket RPC — so the two doors cannot
          // come to answer differently, which is the #19 divergence. This door exists at
          // all because of #20: a browser bootstraps over HTTP before resuming the
          // socket, so a read wired only to the socket is a read a user cannot reach.
          return yield* readChannelPostPage({
            request: {
              channelId: args.params.channelId,
              direction: args.payload.direction,
              limit: args.payload.limit,
              ...(args.payload.cursor === undefined ? {} : { cursor: args.payload.cursor }),
            },
            member: refFromOperatorSession(),
          }).pipe(
            // ONE TOTAL MAPPING, not a chain ending in a catch-all. A trailing
            // `Effect.catch` here caught the 404 this handler had just produced
            // and reported it as a 500, so every membership refusal on this door
            // was an internal error — the door test is what said so. Listing the
            // tags makes a new error in the shared handler a type error here
            // instead of a silent 500.
            Effect.catchTags({
              ChannelPostsUnreadable: () => failEnvironmentNotFound("channel_not_found"),
              // A FOREIGN CURSOR IS A BAD REQUEST, not an empty page — which is
              // the answer for "you are caught up" (`decodeChannelCursor`).
              ChannelCursorRejected: () => failEnvironmentInvalidRequest("invalid_cursor"),
              PersistenceDecodeError: (cause) =>
                failEnvironmentInternal("orchestration_snapshot_failed", cause),
              PersistenceSqlError: (cause) =>
                failEnvironmentInternal("orchestration_snapshot_failed", cause),
            }),
          );
        }),
      )
      .handle(
        "dispatch",
        Effect.fn("environment.orchestration.dispatch")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          const normalizedCommand = yield* normalizeDispatchCommand(args.payload).pipe(
            Effect.catch(() => failEnvironmentInvalidRequest("invalid_command")),
          );
          // THE SECOND DOOR INTO THE SAME UNION, and it used to pass no issuer.
          // `ClientOrchestrationCommand` is this route's payload and the
          // WebSocket RPC's, so widening it widened both; stamping only the
          // socket left every channel command here failing closed as a 500.
          return yield* orchestrationEngine
            .dispatch(normalizedCommand, { issuer: operatorCommandIssuer() })
            .pipe(
              Effect.tapError(() =>
                cleanupFailedUploadedAttachments(args.payload, normalizedCommand),
              ),
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_dispatch_failed", cause),
              ),
            );
        }),
      );
  }),
);
