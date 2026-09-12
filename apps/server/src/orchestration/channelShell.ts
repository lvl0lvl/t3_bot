import type { OrchestrationChannelShell, OrchestrationShellSnapshot } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import {
  ProjectionChannelRepository,
  type ChannelMemberRef,
  type ProjectionChannelWithActivity,
} from "../persistence/Services/ProjectionChannels.ts";

/**
 * One projected channel row, as the wire shape.
 *
 * ONE CONVERSION FOR BOTH DOORS. The snapshot and the live stream each need a
 * channel shell from the same row, and two copies of this mapping is how one of
 * them comes to drop `latestPostAt` — the field the sidebar orders by and the
 * only reason the per-post event could be deleted. A refetch that sent null
 * there would reorder the channel to the bottom and render "nothing here yet"
 * over a channel that had just received a post.
 *
 * MEMBERS ARE DROPPED, deliberately. `OrchestrationChannelShell` has no members
 * field: the channels a client is sent are the ones it belongs to, so a roster
 * on the wire would tell it who else is in them and cost a list it never
 * renders.
 *
 * THAT IS TRUE OF THIS PAYLOAD AND NOT OF THE REMOVAL EVENT, and the difference
 * is worth stating here because this docstring is where a reader looks for the
 * rule. `channel-removed` carries a bare `channelId`, and the stream emits it
 * for a channel the connection is NOT a member of — so a change to any channel
 * on the server tells every connected client that a channel with that id
 * exists. See `channelShellFor` in `ws.ts`, which says why neither available fix
 * works.
 */
export function toChannelShell(row: ProjectionChannelWithActivity): OrchestrationChannelShell {
  return {
    id: row.channelId,
    name: row.name,
    archivedAt: row.archivedAt,
    latestPostAt: row.latestPostAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Whether a projected row's roster contains this member.
 *
 * BOTH FIELDS, and the pair is the point: `memberKind` says what a member IS —
 * a thread that can be woken, or a human at the keyboard — and two members can
 * share an id across kinds. Comparing the id alone would let a thread named
 * `human-walt` read the operator's channels.
 */
export function rowHasMember(
  row: ProjectionChannelWithActivity,
  member: ChannelMemberRef,
): boolean {
  return row.members.some(
    (candidate) =>
      candidate.memberKind === member.memberKind && candidate.memberId === member.memberId,
  );
}

/**
 * A shell snapshot with the channels this member belongs to attached.
 *
 * ONE FUNCTION FOR BOTH ENTRY POINTS — the websocket subscription and the HTTP
 * shell route — because the HTTP one is what a browser actually bootstraps from,
 * and then resumes by sequence. Wiring only the socket left the sidebar
 * permanently empty while every socket-side test passed: the snapshot the client
 * kept had no channels at all, and `channel-upserted` fires only when a channel
 * CHANGES, so two channels sitting still were invisible forever.
 *
 * READ AFTER THE SNAPSHOT, never before, and the order is load-bearing.
 * `snapshotSequence` comes from the projector cursor, so channels read
 * afterwards are at least as fresh as that sequence: a channel that changed in
 * between arrives again as an upsert with a higher sequence and the client
 * applies it a second time, which is idempotent. Reading channels FIRST would
 * let a channel created in the gap be both absent from the list and older than
 * the cursor that suppresses its event.
 *
 * `getShellSnapshot` stays member-agnostic. Membership is the caller's to
 * supply, which is why it is a parameter here and a filter in the query rather
 * than a rule in whichever component renders the list.
 */
export function withMemberChannels(input: {
  readonly snapshot: OrchestrationShellSnapshot;
  readonly member: ChannelMemberRef;
}): Effect.Effect<
  OrchestrationShellSnapshot,
  ProjectionRepositoryError,
  ProjectionChannelRepository
> {
  return Effect.gen(function* () {
    const projectionChannels = yield* ProjectionChannelRepository;
    const rows = yield* projectionChannels.listChannelsForMember(input.member);
    return { ...input.snapshot, channels: rows.map(toChannelShell) };
  });
}
