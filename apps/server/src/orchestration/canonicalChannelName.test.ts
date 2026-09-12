import { ChannelId, ChannelMemberHandle, CommandId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  canonicalChannelHandle,
  canonicalChannelName,
  requireCanonicalChannelHandle,
  requireCanonicalChannelName,
} from "./commandInvariants.ts";

/**
 * The canonical-name rule, as a table.
 *
 * Two normalisers exist for one rule — this one, which decides what is STORED,
 * and the comms toolkit's, which decides what a lookup SEARCHES for. They
 * disagreed once already (this side stripped a single "#", the toolkit stripped
 * a run of them), and the failure is silent: a lookup that misses reports the
 * same error a non-member gets, so an agent cannot tell a typo from exclusion.
 *
 * Both sides assert these same rows, so a future divergence breaks a named row
 * rather than surfacing as an unreachable channel. Keep the two copies
 * identical; the last rows are the ones worth keeping if anyone trims it.
 */
const TABLE: ReadonlyArray<readonly [input: string, canonical: string]> = [
  ["seniors", "seniors"],
  ["#seniors", "seniors"],
  ["##seniors", "seniors"],
  ["###a", "a"],
  // Case alone, and case with a sigil: the fold is the subject of this rule, and
  // a table without a bare-case row passes just as happily with the fold removed.
  ["Seniors", "seniors"],
  ["#SENIORS", "seniors"],
  ["  ##SENIORS  ", "seniors"],
  ["# seniors", "seniors"],
  // Only sigils and whitespace: no canonical form at all. These are the rows
  // requireCanonicalChannelName must refuse rather than store.
  ["#", ""],
  ["##", ""],
  ["#   ", ""],
  // A sigil that is not leading is part of the name. These are what a regex
  // slip breaks: `replace(/#+/g, "")` passes every other row in this table.
  ["#-#", "-#"],
  ["a#b", "a#b"],
];

/** Rows as "input -> result", so a failure names the input that moved. */
function render(rows: ReadonlyArray<readonly [string, string]>): ReadonlyArray<string> {
  return rows.map(([input, canonical]) => `${input} -> ${canonical}`);
}

const CREATE_COMMAND = {
  type: "channel.create",
  commandId: CommandId.make("cmd-canonical"),
  channelId: ChannelId.make("channel-canonical"),
  name: "seniors",
  members: [
    {
      handle: ChannelMemberHandle.make("pm"),
      memberKind: "thread",
      memberId: "thread-pm",
    },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

it("canonicalises every row of the shared table", () => {
  const actual = render(TABLE.map(([input]) => [input, canonicalChannelName(input)] as const));
  expect(actual).toEqual(render(TABLE));
});

it("is idempotent, so a stored name canonicalises to itself", () => {
  // Storage holds the canonical name and every lookup re-canonicalises what the
  // caller typed. If a second pass moved, a channel would stop matching its own
  // name the moment anything round-tripped it.
  const once = TABLE.map(([input]) => canonicalChannelName(input));
  const twice = once.map((name) => canonicalChannelName(name));
  expect(render(once.map((name, index) => [name, twice[index] ?? ""] as const))).toEqual(
    render(once.map((name) => [name, name] as const)),
  );
});

/**
 * The handle rows, derived from the name rows rather than retyped.
 *
 * A handle is the same rule with "@", so the table holds with the sigil
 * swapped. Deriving it means the two cannot drift: a row added above is a row
 * asserted here, and there is no second copy to forget.
 */
const HANDLE_TABLE = TABLE.map(
  ([input, canonical]) => [input.replaceAll("#", "@"), canonical.replaceAll("#", "@")] as const,
);

it("applies the same rule to handles, with @ as the sigil", () => {
  // The toolkit folds "@Boss1" to "boss1" to resolve a mention against stored
  // membership. A handle stored as typed makes every capitalised mention
  // unresolvable, and the post is refused whole rather than mis-delivered.
  const actual = HANDLE_TABLE.map(([input]) => [input, canonicalChannelHandle(input)] as const);
  expect(render(actual)).toEqual(render(HANDLE_TABLE));
});

it.effect("refuses a handle that is only sigils and whitespace", () =>
  Effect.gen(function* () {
    for (const [input] of HANDLE_TABLE.filter(([, out]) => out.length === 0)) {
      const error = yield* requireCanonicalChannelHandle({
        command: CREATE_COMMAND,
        handle: input,
      }).pipe(Effect.flip);
      expect(error._tag, `input <${input}>`).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("no canonical form");
      }
    }
  }),
);

it.effect("returns the canonical name for every row that has one", () =>
  Effect.gen(function* () {
    for (const [input, canonical] of TABLE.filter(([, out]) => out.length > 0)) {
      const result = yield* requireCanonicalChannelName({ command: CREATE_COMMAND, name: input });
      expect(result, `input <${input}>`).toBe(canonical);
    }
  }),
);

it.effect("refuses a name that is only sigils and whitespace", () =>
  Effect.gen(function* () {
    // The command schema validates the RAW name, so "#" passes TrimmedNonEmptyString
    // and canonicalises to "". Without this check the event carries name "", which
    // no toolkit lookup can ever reach while it holds the empty-string slot.
    const empties = TABLE.filter(([, out]) => out.length === 0);
    expect(empties.length, "the empty rows are what make the non-empty check meaningful").toBe(3);
    for (const [input] of empties) {
      const error = yield* requireCanonicalChannelName({
        command: CREATE_COMMAND,
        name: input,
      }).pipe(Effect.flip);
      expect(error._tag, `input <${input}>`).toBe("OrchestrationCommandInvariantError");
      // Pins THIS invariant: a different guard firing first would satisfy the
      // _tag and the test would survive deleting the one it names.
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("no canonical form");
      }
    }
  }),
);
