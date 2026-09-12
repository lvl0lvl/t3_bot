import type * as Crypto from "effect/Crypto";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { type CreateChannelPostInput, createChannelPost } from "../operations/commands.ts";
import { createAtomCommandScheduler, createEnvironmentCommand } from "./runtime.ts";

export type { CreateChannelPostInput } from "../operations/commands.ts";

export function createChannelEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  return {
    post: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:channel:post",
      execute: (input: CreateChannelPostInput) => createChannelPost(input),
      scheduler,
      // Serial PER CHANNEL, so two posts typed quickly reach the aggregate in
      // the order they were sent. Keyed on the channel rather than globally: a
      // post to #seniors has no reason to wait behind one to #project, and the
      // aggregate they contend for is the channel.
      concurrency: {
        mode: "serial" as const,
        key: ({ environmentId, input }: { environmentId: string; input: { channelId: string } }) =>
          JSON.stringify([environmentId, input.channelId]),
      },
    }),
  };
}
