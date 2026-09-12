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
 * These rows are the agreed rule. The toolkit's normaliser is MEANT to assert
 * the same ones, and does not yet — until that lands, a green here proves this
 * side follows the rule, not that the two sides agree. Keep the copies
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
  // A sigil hiding behind a space. A single strip-and-trim leaves "#seniors",
  // which canonicalises again to something else — so without the fixpoint a
  // stored name does not match itself and the idempotence test below is false
  // for inputs the table never asked about.
  ["# #seniors", "seniors"],
  ["#  #  x", "x"],
  // Decomposed "e" + U+0301 must reach the composed form: same text, and
  // without NFC it is a second channel nobody can tell from the first.
  ["caf\u0065\u0301", "caf\u00e9"],
  ["#CAF\u0045\u0301", "caf\u00e9"],
];

/**
 * The rows split once, with a tripwire on each side.
 *
 * Every loop below is driven from these. A filter that silently returns nothing
 * runs no loop body and passes green having asserted nothing — which would
 * retire the only coverage the empty-canonical refusals have. The counts are
 * what stop a trimmed table taking a guard with it.
 */
const EMPTY_ROWS = TABLE.filter(([, canonical]) => canonical.length === 0);
const NAMED_ROWS = TABLE.filter(([, canonical]) => canonical.length > 0);

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

it("keeps every row of the table reachable by the loops below", () => {
  // The tripwire. Each count is the number of rows some loop depends on, so a
  // trimmed table fails here rather than quietly emptying a filter and leaving
  // a loop that asserts nothing.
  expect(EMPTY_ROWS.length, "the empty rows are the only coverage the refusals have").toBe(3);
  expect(NAMED_ROWS.length).toBe(TABLE.length - 3);
  expect(
    HANDLE_EMPTY_ROWS.length,
    "the handle loop derives its own rows and needs its own count",
  ).toBe(3);
});

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
const HANDLE_EMPTY_ROWS = HANDLE_TABLE.filter(([, canonical]) => canonical.length === 0);

it("applies the same rule to handles, with @ as the sigil", () => {
  // The toolkit is to fold "@Boss1" to "boss1" when resolving a mention against
  // stored membership. Folding there before handles are stored folded makes
  // every capitalised mention unresolvable and refuses the post whole, so this
  // side goes first.
  const actual = HANDLE_TABLE.map(([input]) => [input, canonicalChannelHandle(input)] as const);
  expect(render(actual)).toEqual(render(HANDLE_TABLE));
});

it.effect("refuses a handle that is only sigils and whitespace", () =>
  Effect.gen(function* () {
    for (const [input] of HANDLE_EMPTY_ROWS) {
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
    for (const [input, canonical] of NAMED_ROWS) {
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
    for (const [input] of EMPTY_ROWS) {
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
