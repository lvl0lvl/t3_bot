import {
  ChannelId,
  EnvironmentId,
  type OrchestrationChannelShell,
  type OrchestrationShellSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";

import { PrimaryConnectionTarget } from "../connection/model.ts";
import { createEnvironmentChannelShellAtoms } from "./channelShell.ts";
import type { EnvironmentShellState } from "./shell.ts";
import { createEnvironmentSnapshotAtom } from "./snapshots.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const OTHER_ENVIRONMENT_ID = EnvironmentId.make("environment-2");

const channel = (
  id: string,
  fields: Partial<OrchestrationChannelShell> = {},
): OrchestrationChannelShell => ({
  id: ChannelId.make(id),
  name: id,
  archivedAt: null,
  latestPostAt: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  ...fields,
});

const snapshot = (
  channels: ReadonlyArray<OrchestrationChannelShell> | undefined,
): OrchestrationShellSnapshot => ({
  snapshotSequence: 1,
  updatedAt: "2026-04-01T00:00:00.000Z",
  projects: [],
  threads: [],
  ...(channels === undefined ? {} : { channels }),
});

function makeHarness(
  snapshots: ReadonlyArray<readonly [EnvironmentId, OrchestrationShellSnapshot]>,
) {
  const byEnvironment = new Map(snapshots);
  const shellStateAtoms = Atom.family((environmentId: EnvironmentId) => {
    const found = byEnvironment.get(environmentId);
    return Atom.make(
      AsyncResult.success<EnvironmentShellState>({
        snapshot: found === undefined ? Option.none() : Option.some(found),
        status: "live",
        error: Option.none(),
      }),
    );
  });
  const catalogValueAtom = Atom.make({
    isReady: true,
    entries: new Map(
      snapshots.map(([environmentId]) => [
        environmentId,
        {
          target: new PrimaryConnectionTarget({
            environmentId,
            label: "Environment",
            httpBaseUrl: "https://example.test",
            wsBaseUrl: "wss://example.test",
          }),
          profile: Option.none(),
        },
      ]),
    ),
  });

  return {
    registry: AtomRegistry.make(),
    channels: createEnvironmentChannelShellAtoms({
      catalogValueAtom,
      snapshotAtom: createEnvironmentSnapshotAtom(shellStateAtoms),
    }),
  };
}

describe("channel shell atoms", () => {
  it("orders by latest post, not by creation", () => {
    // The two orderings are OPPOSITE in this fixture, which is the only kind of
    // fixture that can tell them apart: "quiet" was created later but its last
    // post is older, and "busy" was created first and has a post from today. A
    // list sorted by createdAt puts quiet first; the sidebar has to put busy
    // first, because the channel with new traffic is the one an operator wants.
    const harness = makeHarness([
      [
        ENVIRONMENT_ID,
        snapshot([
          channel("busy", {
            createdAt: "2026-04-01T00:00:00.000Z",
            latestPostAt: "2026-04-09T00:00:00.000Z",
          }),
          channel("quiet", {
            createdAt: "2026-04-05T00:00:00.000Z",
            latestPostAt: "2026-04-06T00:00:00.000Z",
          }),
        ]),
      ],
    ]);

    const ids = harness.registry.get(harness.channels.channelsAtom).map((c) => c.id);

    expect(ids).toEqual(["busy", "quiet"]);
  });

  it("sorts a channel nobody has posted in by when it was created", () => {
    // `latestPostAt` is null for a channel with no posts. Treating null as the
    // epoch buries a channel created a minute ago underneath one whose last post
    // was a week ago — so "new-empty", created today and never posted in, sorts
    // ABOVE "old-busy", whose only post is from last week.
    const harness = makeHarness([
      [
        ENVIRONMENT_ID,
        snapshot([
          channel("old-busy", {
            createdAt: "2026-04-01T00:00:00.000Z",
            latestPostAt: "2026-04-02T00:00:00.000Z",
          }),
          channel("new-empty", {
            createdAt: "2026-04-08T00:00:00.000Z",
            latestPostAt: null,
          }),
        ]),
      ],
    ]);

    const ids = harness.registry.get(harness.channels.channelsAtom).map((c) => c.id);

    expect(ids).toEqual(["new-empty", "old-busy"]);
  });

  it("breaks a tie on id rather than on the order the server happened to send", () => {
    // Both channels have the same effective timestamp, so the comparator has
    // nothing to separate them and a stable sort would keep the snapshot's
    // order. The snapshot here lists them in the REVERSE of id order, so a
    // comparator that returns 0 on a tie renders "b" above "a" — and the point of
    // sorting in the atom is that every consumer agrees, which requires the order
    // not to depend on what the server happened to send.
    const harness = makeHarness([
      [
        ENVIRONMENT_ID,
        snapshot([
          channel("b", { latestPostAt: "2026-04-09T00:00:00.000Z" }),
          channel("a", { latestPostAt: "2026-04-09T00:00:00.000Z" }),
        ]),
      ],
    ]);

    const ids = harness.registry.get(harness.channels.channelsAtom).map((c) => c.id);

    expect(ids).toEqual(["a", "b"]);
  });

  it("keeps two channels with the same id apart by environment", () => {
    // A client connected to two servers sees two `#seniors`. They are different
    // channels and the id alone cannot say which is which, so the list carries
    // the environment and the point read is keyed on it.
    const harness = makeHarness([
      [ENVIRONMENT_ID, snapshot([channel("seniors")])],
      [OTHER_ENVIRONMENT_ID, snapshot([channel("seniors", { name: "seniors (other)" })])],
    ]);

    const both = harness.registry.get(harness.channels.channelsAtom);
    const fromOther = harness.registry.get(
      harness.channels.channelAtom({
        environmentId: OTHER_ENVIRONMENT_ID,
        channelId: ChannelId.make("seniors"),
      }),
    );

    expect(both.map((c) => c.environmentId)).toEqual([ENVIRONMENT_ID, OTHER_ENVIRONMENT_ID]);
    expect(fromOther?.name).toBe("seniors (other)");
  });

  it("hands the list and the point read the same object", () => {
    // A component reading one channel and a list rendering the same channel must
    // not get two objects that compare unequal, or the two rerender out of step.
    const harness = makeHarness([[ENVIRONMENT_ID, snapshot([channel("seniors")])]]);

    const fromList = harness.registry.get(harness.channels.channelsAtom)[0];
    const fromPoint = harness.registry.get(
      harness.channels.channelAtom({
        environmentId: ENVIRONMENT_ID,
        channelId: ChannelId.make("seniors"),
      }),
    );

    expect(fromPoint).toBe(fromList);
  });

  it("tells an empty channel list apart from a server that has no channels", () => {
    // `[]` means "you are in no channels" and is fixed by joining one. An absent
    // field means the server predates channels, or no snapshot has arrived, and
    // joining a channel would not change it. The list is `[]` in both cases, so
    // the distinction has to live somewhere else or the UI tells an operator to
    // join a channel on a server that cannot have them.
    const harness = makeHarness([
      [ENVIRONMENT_ID, snapshot([])],
      [OTHER_ENVIRONMENT_ID, snapshot(undefined)],
    ]);

    expect(
      harness.registry.get(harness.channels.environmentSupportsChannelsAtom(ENVIRONMENT_ID)),
    ).toBe(true);
    expect(
      harness.registry.get(harness.channels.environmentSupportsChannelsAtom(OTHER_ENVIRONMENT_ID)),
    ).toBe(false);
    expect(harness.registry.get(harness.channels.channelsAtom)).toEqual([]);
  });
});
