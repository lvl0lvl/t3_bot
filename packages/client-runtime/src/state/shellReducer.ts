import * as Arr from "effect/Array";
import type { OrchestrationShellSnapshot, OrchestrationShellStreamEvent } from "@t3tools/contracts";

/**
 * Reduce a single shell stream event into an existing snapshot, returning a new
 * snapshot with the event's changes applied. This is a pure reducer that both
 * web and mobile can use to keep their local shell snapshot in sync.
 *
 * Returns the original snapshot reference unchanged if the event is not
 * recognized (forward-compatible).
 */
export function applyShellStreamEvent(
  snapshot: OrchestrationShellSnapshot,
  event: OrchestrationShellStreamEvent,
): OrchestrationShellSnapshot {
  if (event.sequence <= snapshot.snapshotSequence) return snapshot;

  switch (event.kind) {
    case "project-upserted": {
      const projects = snapshot.projects.some((p) => p.id === event.project.id)
        ? Arr.map(snapshot.projects, (p) => (p.id === event.project.id ? event.project : p))
        : Arr.append(snapshot.projects, event.project);
      return { ...snapshot, projects, snapshotSequence: event.sequence };
    }
    case "project-removed":
      return {
        ...snapshot,
        projects: Arr.filter(snapshot.projects, (p) => p.id !== event.projectId),
        snapshotSequence: event.sequence,
      };
    case "thread-upserted": {
      const threads = snapshot.threads.some((t) => t.id === event.thread.id)
        ? Arr.map(snapshot.threads, (t) => (t.id === event.thread.id ? event.thread : t))
        : Arr.append(snapshot.threads, event.thread);
      return { ...snapshot, threads, snapshotSequence: event.sequence };
    }
    case "thread-removed":
      return {
        ...snapshot,
        threads: Arr.filter(snapshot.threads, (t) => t.id !== event.threadId),
        snapshotSequence: event.sequence,
      };
    case "channel-upserted": {
      // `channels` is optional on the wire so a snapshot cached from a server
      // without channels still decodes. An upsert is the point at which this
      // client learns the server HAS them, so materialising the field here is
      // reporting what arrived rather than inventing it.
      const existing = snapshot.channels ?? [];
      const channels = existing.some((c) => c.id === event.channel.id)
        ? Arr.map(existing, (c) => (c.id === event.channel.id ? event.channel : c))
        : Arr.append(existing, event.channel);
      return { ...snapshot, channels, snapshotSequence: event.sequence };
    }
    case "channel-removed":
      // ABSENT AND EMPTY ARE DIFFERENT, and a removal must not convert one into
      // the other. `undefined` means "this server never told us about channels";
      // `[]` means "you are in none". Writing `[]` here on a snapshot that has
      // no field would claim the second on the strength of the first.
      //
      // THE CONSUMER IS THE CHANNEL ROUTE, not the sidebar. An earlier version
      // of this comment argued the branch from a sidebar that renders the two
      // states differently — it does not, it renders nothing for both, because
      // `channelsAtom` flattens them. `environmentChannelSupportAtom` is what
      // reads the difference, and `ChannelView` turns it into "this server has
      // no channels" versus a loading state. Collapsing it here would put that
      // sentence on screen for a server that simply has not answered yet.
      return snapshot.channels === undefined
        ? { ...snapshot, snapshotSequence: event.sequence }
        : {
            ...snapshot,
            channels: Arr.filter(snapshot.channels, (c) => c.id !== event.channelId),
            snapshotSequence: event.sequence,
          };
    default:
      return snapshot;
  }
}
