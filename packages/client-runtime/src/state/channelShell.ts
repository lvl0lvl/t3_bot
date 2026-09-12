import type {
  ChannelId,
  EnvironmentId,
  OrchestrationChannelShell,
  OrchestrationShellSnapshot,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentCatalogState } from "./connections.ts";
import { arrayElementsEqual } from "./entities.ts";

/** One channel in one environment. Neither id identifies a channel alone. */
export interface ScopedChannelRef {
  readonly environmentId: EnvironmentId;
  readonly channelId: ChannelId;
}

/**
 * The one string that identifies a channel across environments.
 *
 * Exported because the atom family is not the only thing that needs it — a React
 * key over the channel list needs the same identity, and the first version of
 * that key spelled the separator by hand and got a literal NUL BYTE in the
 * source file rather than the escape, which renders as a space and makes git
 * report the file as binary. Two spellings of one convention is the drift this
 * function exists to prevent; a third is not better for being short.
 *
 * NUL, as the escape, matching `threadKey`. A separator either side could
 * contain gives two different refs one key — the wake key hit exactly that with
 * a colon and had to escape both halves.
 */
const KEY_SEPARATOR = "\u0000";

export function channelKey(ref: ScopedChannelRef): string {
  return `${ref.environmentId}${KEY_SEPARATOR}${ref.channelId}`;
}

/**
 * A channel carrying the environment it came from, so a client connected to
 * several servers can tell two `#seniors` apart.
 */
export interface EnvironmentChannelShell extends OrchestrationChannelShell {
  readonly environmentId: EnvironmentId;
}

/**
 * The list flattens "no channels field" to `[]`, and the distinction is carried
 * by `environmentSupportsChannelsAtom` instead.
 *
 * A list cannot carry it: a server that predates channels, a snapshot that has
 * not arrived, and a member who is in none all have to render as something, and
 * every one of them is an empty array. Those are different states — the first
 * cannot be fixed by joining a channel and the last can — so the thing that
 * tells them apart is a separate atom rather than a nullable list every consumer
 * would have to remember to check.
 */
const EMPTY_CHANNELS: ReadonlyArray<OrchestrationChannelShell> = Object.freeze([]);

export function createEnvironmentChannelShellAtoms(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly snapshotAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<OrchestrationShellSnapshot | null>;
}) {
  // Scoped values are cached against the source object so a point read and the
  // aggregate list hand out the same reference, and a replaced channel can be
  // collected. Same reason the thread version does it.
  const scopedChannels = new WeakMap<
    OrchestrationChannelShell,
    Map<EnvironmentId, EnvironmentChannelShell>
  >();
  const scopedChannel = (environmentId: EnvironmentId, channel: OrchestrationChannelShell) => {
    let byEnvironment = scopedChannels.get(channel);
    if (byEnvironment === undefined) {
      byEnvironment = new Map();
      scopedChannels.set(channel, byEnvironment);
    }
    let value = byEnvironment.get(environmentId);
    if (value === undefined) {
      value = { ...channel, environmentId };
      byEnvironment.set(environmentId, value);
    }
    return value;
  };

  const environmentChannelsAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): ReadonlyArray<OrchestrationChannelShell> => {
      const snapshot = get(input.snapshotAtom(environmentId));
      return snapshot?.channels ?? EMPTY_CHANNELS;
    }).pipe(Atom.withLabel("environment-channels")),
  );

  /**
   * Whether this environment has told us about channels at all.
   *
   * Separate from the list because the list cannot carry the distinction: an
   * environment with no snapshot yet, one whose server has no channels, and one
   * reporting zero memberships all produce `[]`.
   */
  const environmentSupportsChannelsAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(
      (get): boolean => get(input.snapshotAtom(environmentId))?.channels !== undefined,
    ).pipe(Atom.withLabel("environment-supports-channels")),
  );

  let previousChannels: ReadonlyArray<EnvironmentChannelShell> = [];
  const channelsAtom = Atom.make((get) => {
    const next: EnvironmentChannelShell[] = [];
    for (const environmentId of get(input.catalogValueAtom).entries.keys()) {
      for (const channel of get(environmentChannelsAtom(environmentId))) {
        next.push(scopedChannel(environmentId, channel));
      }
    }
    // MOST RECENTLY ACTIVE FIRST, and sorted here rather than in the component:
    // two components ordering the same list two ways is how a sidebar and a
    // command palette come to disagree about which channel is "first".
    //
    // `latestPostAt` is null for a channel nobody has posted in, and null sorts
    // LAST rather than as the epoch — a channel created a minute ago belongs
    // above one created last week, not below both.
    next.sort((left, right) => {
      const leftAt = left.latestPostAt ?? left.createdAt;
      const rightAt = right.latestPostAt ?? right.createdAt;
      if (leftAt === rightAt) return left.id.localeCompare(right.id);
      return leftAt < rightAt ? 1 : -1;
    });
    if (arrayElementsEqual(previousChannels, next)) {
      return previousChannels;
    }
    previousChannels = next;
    return previousChannels;
  }).pipe(Atom.withLabel("environment-channel-shell-list"));

  const channelAtomFamily = Atom.family((key: string) =>
    Atom.make((get): EnvironmentChannelShell | null => {
      // The SAME constant `channelKey` writes. Hand-spelling it here would be
      // the two-sides-must-agree shape again: a writer and a reader of one
      // convention, free to disagree — which is how the mention boundary came
      // to have an opener set and a terminator set that did not match.
      const separator = key.indexOf(KEY_SEPARATOR);
      if (separator < 0) return null;
      const environmentId = key.slice(0, separator) as EnvironmentId;
      const channelId = key.slice(separator + 1) as ChannelId;
      for (const channel of get(environmentChannelsAtom(environmentId))) {
        if (channel.id === channelId) return scopedChannel(environmentId, channel);
      }
      return null;
    }).pipe(Atom.withLabel("environment-channel-shell")),
  );

  return {
    environmentChannelsAtom,
    environmentSupportsChannelsAtom,
    channelsAtom,
    channelAtom: (ref: ScopedChannelRef) => channelAtomFamily(channelKey(ref)),
  };
}
