import { ChannelId, ChannelMemberHandle, CommandId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { FORBIDDEN_IN_CANONICAL_IDENTITY } from "@t3tools/shared/channelIdentity";

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
 * These rows are the agreed rule. There is no longer a second normaliser to
 * assert them against: the toolkit imports this same function, and
 * canonicalOneImplementation.test.ts pins that by REFERENCE rather than by
 * behaviour, because two copies that agree today are two copies that can be
 * improved apart tomorrow. Duplicating these rows on the toolkit's side would
 * assert the function against itself.
 */
export const CANONICAL_IDENTITY_TABLE: ReadonlyArray<readonly [input: string, canonical: string]> =
  [
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
    // Lowercasing can make a sequence NEWLY composable, so NFC has to run AFTER
    // the fold. Normalising first left "H"+U+0331 as "h"+U+0331 while a roster
    // held the precomposed U+1E96 — two members rendering identically. These are
    // the rows that tell the two orders apart; no row above can.
    ["H\u0331", "\u1e96"],
    ["\u1e96", "\u1e96"],
    ["J\u030C", "\u01f0"],
    // Exotic spaces are collapsed, not refused: a no-break space and a plain
    // space must be one identity rather than two that render alike.
    ["a\u00A0b", "a b"],
    ["my  channel", "my channel"],
  ];

/**
 * The rows split once, with a tripwire on each side.
 *
 * Every loop below is driven from these. A filter that silently returns nothing
 * runs no loop body and passes green having asserted nothing — which would
 * retire the only coverage the empty-canonical refusals have. The counts are
 * what stop a trimmed table taking a guard with it.
 */
const EMPTY_ROWS = CANONICAL_IDENTITY_TABLE.filter(([, canonical]) => canonical.length === 0);
const NAMED_ROWS = CANONICAL_IDENTITY_TABLE.filter(([, canonical]) => canonical.length > 0);

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
  // ABSOLUTE counts. `NAMED_ROWS.length === TABLE.length - 3` held for ANY table
  // with three empty rows: trimming this table from 17 rows to 9 — losing both
  // NFC rows, both fixpoint rows and the non-leading-sigil rows — left it green.
  // A tripwire derived from the thing it guards is not a tripwire.
  expect(CANONICAL_IDENTITY_TABLE.length, "a row was removed; each one guards a rule").toBe(22);
  expect(EMPTY_ROWS.length, "the empty rows are the only coverage the refusals have").toBe(3);
  expect(NAMED_ROWS.length).toBe(19);
  expect(
    HANDLE_EMPTY_ROWS.length,
    "the handle loop derives its own rows and needs its own count",
  ).toBe(3);
});

it("canonicalises every row of the shared table", () => {
  const actual = render(
    CANONICAL_IDENTITY_TABLE.map(([input]) => [input, canonicalChannelName(input)] as const),
  );
  expect(actual).toEqual(render(CANONICAL_IDENTITY_TABLE));
});

it("is idempotent, so a stored name canonicalises to itself", () => {
  // Storage holds the canonical name and every lookup re-canonicalises what the
  // caller typed. If a second pass moved, a channel would stop matching its own
  // name the moment anything round-tripped it.
  const once = CANONICAL_IDENTITY_TABLE.map(([input]) => canonicalChannelName(input));
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
const HANDLE_TABLE = CANONICAL_IDENTITY_TABLE.map(
  ([input, canonical]) => [input.replaceAll("#", "@"), canonical.replaceAll("#", "@")] as const,
);
const HANDLE_EMPTY_ROWS = HANDLE_TABLE.filter(([, canonical]) => canonical.length === 0);

it("answers the same way twice, so the shared class cannot become stateful", () => {
  // FORBIDDEN_IN_CANONICAL_IDENTITY is used with `.test`, and a regex carrying
  // the global flag keeps `lastIndex` between calls — so `.test` alternates
  // true, false, true on the SAME input. The gate would then admit every second
  // invisible character, which no single-call test can see.
  //
  // It has no `g` today. This exists because adding one is a plausible edit (a
  // second use site wanting `.replace` is how it happens) and the failure is
  // silent: the suite would go half-green in a way that reads as flakiness.
  const invisible = "boss1\u200B";
  expect(FORBIDDEN_IN_CANONICAL_IDENTITY.test(invisible)).toBe(true);
  expect(FORBIDDEN_IN_CANONICAL_IDENTITY.test(invisible)).toBe(true);
  expect(FORBIDDEN_IN_CANONICAL_IDENTITY.test(invisible)).toBe(true);
});

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

/**
 * Idempotence over a RANGE rather than a fixture.
 *
 * The table-driven version of this test was green three separate times while the
 * property was false — for a sigil hidden behind a space, then for whitespace
 * runs, then for anything whose lowercase form is newly composable. Each time the
 * assertion was right and the fixture could not reach the failure.
 *
 * So this asserts the property over every code point in the BMP instead of over
 * rows someone chose. It is the fixture that keeps failing, not the assertion.
 *
 * It does NOT replace the table. Idempotence and DISTINCTNESS are different
 * properties: removing the whitespace collapse leaves the function perfectly
 * idempotent and makes a no-break space a second identity, which only a row
 * naming both spellings can catch. The range pins "canonicalising twice changes
 * nothing"; the table pins "these two inputs are the same channel". Verified by
 * mutation — dropping the collapse reds three table tests and no range test.
 */
it("is idempotent for every single code point in the BMP", () => {
  const moved: Array<string> = [];
  for (let point = 0; point <= 0xffff; point += 1) {
    // Lone surrogates are not scalar values and cannot appear in a valid string.
    if (point >= 0xd800 && point <= 0xdfff) continue;
    const input = String.fromCodePoint(point);
    const once = canonicalChannelName(input);
    if (canonicalChannelName(once) !== once) {
      moved.push(`U+${point.toString(16).toUpperCase().padStart(4, "0")}`);
    }
  }
  expect(moved, "these code points canonicalise to something that canonicalises again").toEqual([]);
});

it("is idempotent across combining pairs, where composition changes length", () => {
  // Pairs, because the failures that reached production were all two-character:
  // a base plus a combining mark whose folded form composes, and a Hangul lead
  // plus vowel that composes into one syllable.
  const ranges: ReadonlyArray<readonly [number, number]> = [
    [0x0041, 0x005a], // ASCII upper
    [0x0300, 0x036f], // combining diacriticals
    [0x1e00, 0x1eff], // latin extended additional
    [0x1100, 0x1112], // hangul lead jamo
    [0x1161, 0x1175], // hangul vowel jamo
  ];
  const points: Array<number> = [];
  for (const [from, to] of ranges) {
    for (let point = from; point <= to; point += 1) points.push(point);
  }
  const moved: Array<string> = [];
  for (const first of points) {
    for (const second of points) {
      const input = String.fromCodePoint(first) + String.fromCodePoint(second);
      const once = canonicalChannelHandle(input);
      if (canonicalChannelHandle(once) !== once) moved.push(input);
      if (moved.length > 4) break;
    }
    if (moved.length > 4) break;
  }
  expect(moved).toEqual([]);
});

it("stores a name in every script a member might use", () => {
  // The accepted set only ever got SMALLER as the character gate tightened, and
  // nothing was watching what fell out of it. An emoji handle did, once.
  const names = [
    "\u65e5\u672c\u8a9e",
    "\ud55c\uad6d\uc5b4",
    "\u0642\u0646\u0627\u0629",
    "\u05e2\u05e8\u05d5\u05e5",
    "\u0939\u093f\u0928\u094d\u0926\u0940",
    "\u0e44\u0e17\u0e22",
    "\u043a\u0430\u043d\u0430\u043b",
    "\u03ba\u03b1\u03bd\u03ac\u03bb\u03b9",
    "\u1100\u1161",
    "caf\u00e9",
    "\u2764\ufe0f",
  ];
  const refused = names.filter((name) => {
    const canonical = canonicalChannelName(name);
    return canonical.length === 0 || FORBIDDEN_IN_CANONICAL_IDENTITY.test(canonical);
  });
  expect(refused, "these are legitimate names the gate now refuses").toEqual([]);
});

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
