import {
  ChannelId,
  ChannelMemberHandle,
  CommandId,
  EventId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { createEmptyReadModel, projectEvent } from "./projector.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-02T00:00:00.000Z";
const CHANNEL = ChannelId.make("channel-1");

function channelEvent(input: {
  readonly sequence: number;
  readonly type: OrchestrationEvent["type"];
  readonly payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.make(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: "channel",
    aggregateId: CHANNEL,
    occurredAt: NOW,
    commandId: CommandId.make(`command-${input.sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

const seeded = () =>
  projectEvent(
    createEmptyReadModel(NOW),
    channelEvent({
      sequence: 1,
      type: "channel.created",
      payload: {
        channelId: CHANNEL,
        name: "seniors",
        members: [
          { handle: ChannelMemberHandle.make("pm"), memberKind: "thread", memberId: "thread-pm" },
          {
            handle: ChannelMemberHandle.make("boss1"),
            memberKind: "thread",
            memberId: "thread-boss1",
          },
          { handle: ChannelMemberHandle.make("walt"), memberKind: "human", memberId: "human-walt" },
        ],
        createdAt: NOW,
        updatedAt: NOW,
      },
    }),
  );

it.effect("a rename changes the row's handle in place and nothing else", () =>
  Effect.gen(function* () {
    const renamed = yield* projectEvent(
      yield* seeded(),
      channelEvent({
        sequence: 2,
        type: "channel.member-renamed",
        payload: {
          channelId: CHANNEL,
          from: ChannelMemberHandle.make("boss1"),
          to: ChannelMemberHandle.make("boss-one"),
          member: { memberKind: "thread", memberId: "thread-boss1" },
          updatedAt: LATER,
        },
      }),
    );
    const channel = renamed.channels.find((entry) => entry.id === CHANNEL);
    // THE WHOLE ROSTER, in order. A remove-then-add projection would move the
    // row to the end; a filter would drop it. The other two rows are asserted
    // too, because a `map` that renamed every row matches the renamed one alone.
    expect(channel?.members).toEqual([
      { handle: "pm", memberKind: "thread", memberId: "thread-pm" },
      { handle: "boss-one", memberKind: "thread", memberId: "thread-boss1" },
      { handle: "walt", memberKind: "human", memberId: "human-walt" },
    ]);
    expect(channel?.updatedAt).toBe(LATER);
  }),
);

it.effect("a rename naming a handle nobody holds changes no row", () =>
  Effect.gen(function* () {
    // Replay of an event the decider would never emit against this roster
    // (the roster it was decided on differs); the projector must not invent a
    // row for it or drop one.
    const before = yield* seeded();
    const after = yield* projectEvent(
      before,
      channelEvent({
        sequence: 2,
        type: "channel.member-renamed",
        payload: {
          channelId: CHANNEL,
          from: ChannelMemberHandle.make("ghost"),
          to: ChannelMemberHandle.make("spirit"),
          member: { memberKind: "thread", memberId: "thread-ghost" },
          updatedAt: LATER,
        },
      }),
    );
    expect(after.channels[0]?.members).toEqual(before.channels[0]?.members);
  }),
);

it.effect("a rename matches `from` on the stored bytes, so a legacy row is repaired", () =>
  Effect.gen(function* () {
    // A row stored before the canonicalisation rule holds `@pm`, which folds to
    // `pm`. The decider emits `from` as stored; a projector that folded `from`
    // before matching would look for `pm`, touch no row, and leave the member
    // stuck under the handle nothing can mention.
    const seededLegacy = yield* projectEvent(
      createEmptyReadModel(NOW),
      channelEvent({
        sequence: 1,
        type: "channel.created",
        payload: {
          channelId: CHANNEL,
          name: "seniors",
          members: [
            {
              handle: ChannelMemberHandle.make("@pm"),
              memberKind: "thread",
              memberId: "thread-pm",
            },
            {
              handle: ChannelMemberHandle.make("boss1"),
              memberKind: "thread",
              memberId: "thread-boss1",
            },
          ],
          createdAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
    const renamed = yield* projectEvent(
      seededLegacy,
      channelEvent({
        sequence: 2,
        type: "channel.member-renamed",
        payload: {
          channelId: CHANNEL,
          from: ChannelMemberHandle.make("@pm"),
          to: ChannelMemberHandle.make("pm"),
          member: { memberKind: "thread", memberId: "thread-pm" },
          updatedAt: LATER,
        },
      }),
    );
    // The ref never leaves the roster: same row, same position, new handle.
    expect(renamed.channels[0]?.members).toEqual([
      { handle: "pm", memberKind: "thread", memberId: "thread-pm" },
      { handle: "boss1", memberKind: "thread", memberId: "thread-boss1" },
    ]);
  }),
);
