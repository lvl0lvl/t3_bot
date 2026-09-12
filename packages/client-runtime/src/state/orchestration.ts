import { ORCHESTRATION_WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createOrchestrationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    turnDiff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:turn-diff",
      tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
    }),
    workflowScript: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:workflow-script",
      tag: ORCHESTRATION_WS_METHODS.getWorkflowScript,
      // Scripts are immutable per run: cache generously.
      staleTimeMs: 300_000,
      idleTtlMs: 300_000,
    }),
    fullThreadDiff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:full-thread-diff",
      tag: ORCHESTRATION_WS_METHODS.getFullThreadDiff,
    }),
    threadSearch: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:thread-search",
      tag: ORCHESTRATION_WS_METHODS.searchThreads,
      staleTimeMs: 30_000,
      idleTtlMs: 60_000,
    }),
    archivedShellSnapshot: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:archived-shell-snapshot",
      tag: ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
    }),
    /**
     * One page of a channel's posts, keyed by the whole request.
     *
     * CACHED LIKE EVERY OTHER FAMILY HERE, and an earlier version of this comment
     * claimed the opposite. `createEnvironmentRpcQueryAtomFamily` gives all of
     * them `Atom.swr` with a 30s stale time and a 5-minute idle TTL, and passing
     * neither option leaves this byte-identical in configuration to `turnDiff`
     * and `fullThreadDiff` — the very atoms the old comment said it differed
     * from. Wrong in both halves, in the file where cache policy is declared.
     *
     * The staleness that matters is handled in the view instead: `ChannelView`
     * refreshes this atom when the channel shell reports a newer `latestPostAt`,
     * so a reply is not waiting on a stale window to expire.
     */
    channelPosts: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:channel-posts",
      tag: ORCHESTRATION_WS_METHODS.readChannelPosts,
    }),
  };
}
