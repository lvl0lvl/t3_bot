import { assert, describe, it } from "vite-plus/test";

import { turnIdBrandSites } from "./turnIdBrandSites.ts";

// The fifteen shapes #54's review ran against the pin, as the helper's own
// table: each row is a line a sync maintainer could write, and whether the
// helper counts it. The previous strip (`\/\*(?!...)` before the lookahead,
// so a `*` line was never tested for code after its `*/`) let the
// block-close-with-code rows through as comments; the previous match
// (`TurnId\.make\(`) did not see `TurnId?.make(` and `TurnId!.make(`; the
// lookahead's `[ \t]*` as `\s*` crosses the newline and un-comments a
// single-line block followed by code on the next line. Any of them put back
// reds this table.
const base = ["const a = TurnId.make(id);", "const b = TurnId.make(`opencode-turn-${x}`);"].join(
  "\n",
);
const baseSites = ["TurnId.make(id)", "TurnId.make(`opencode-turn-${x}`)"];

describe("turnIdBrandSites", () => {
  it("lists the literal calls in order, and nothing for a source without one", () => {
    assert.deepEqual(turnIdBrandSites(base), baseSites);
    assert.deepEqual(turnIdBrandSites("const a = 1;\n"), []);
  });

  const rows: ReadonlyArray<readonly [string, string, ReadonlyArray<string>]> = [
    // Comment-only lines: not brand sites.
    [
      "a line comment and a single-line block",
      "// TurnId.make(turn.id)\n/* TurnId.make(turn.id) */\n",
      [],
    ],
    ["a doc block's `*` line", "/**\n * TurnId.make(turn.id)\n */\n", []],
    [
      "a single-line block on the line before code",
      "/* TurnId.make(turn.id) */\nconst next = 1;\n",
      [],
    ],
    [
      "a line comment that quotes a `*/` before the call",
      "// closes with `*/` then TurnId.make(turn.id)\n",
      [],
    ],
    // Code after a comment on the same line: counted.
    [
      "a doc block closed on a line that carries code",
      "/**\n * note\n */ const leaked = (turn: { id: string }) => TurnId.make(turn.id);\n",
      ["TurnId.make(turn.id)"],
    ],
    [
      "a plain block closed on a line that carries code",
      "/*\n  note\n*/ const leaked = (turn: { id: string }) => TurnId.make(turn.id);\n",
      ["TurnId.make(turn.id)"],
    ],
    [
      "a leading single-line block before code",
      "/* note */ const collectOne = (turn: { id: string }) => TurnId.make(turn.id);\n",
      ["TurnId.make(turn.id)"],
    ],
    // Upstream's shape (efccda9ac, fd5553f1a): a `.make` inside a map.
    [
      "a call inside a map over a page",
      "const f = (page: any, turns: any[]) => turns.push(...page.data.map((turn: any) => ({ id: TurnId.make(turn.id), items: turn.items })));\n",
      ["TurnId.make(turn.id)"],
    ],
    // Counted by design: a pin reds and the comment is reworded, not listed.
    [
      "a trailing comment after code",
      "const one = 1; // TurnId.make(turn.id)\n",
      ["TurnId.make(turn.id)"],
    ],
    [
      "a block comment after another block",
      "/* a */ /* TurnId.make(turn.id) */\n",
      ["TurnId.make(turn.id)"],
    ],
    ["a line comment after a block", "/* a */ // TurnId.make(turn.id)\n", ["TurnId.make(turn.id)"]],
    ["a string literal", 'const s = "TurnId.make(turn.id)";\n', ["TurnId.make(turn.id)"]],
    // The optional-chain and non-null forms.
    [
      "an optional chain",
      "const g = (turn: { id: string }) => TurnId?.make(turn.id);\n",
      ["TurnId?.make(turn.id)"],
    ],
    [
      "a non-null assertion",
      "const g = (turn: { id: string }) => TurnId!.make(turn.id);\n",
      ["TurnId!.make(turn.id)"],
    ],
    // Not seen by design (a match loosened to `TurnId\W*make\W*\(` would see the
    // bracket access; this row is what reds it).
    [
      "a `.call` on make",
      "const g = (turn: { id: string }) => TurnId.make.call(TurnId, turn.id);\n",
      [],
    ],
    ["a bracket access", 'const g = (turn: { id: string }) => TurnId["make"](turn.id);\n', []],
    ["a longer identifier ending in TurnId", "const g = (x: string) => FooTurnId.make(x);\n", []],
    // Arguments across lines are captured whole.
    [
      "arguments across lines",
      "const g = (turn: { id: string }) =>\n  TurnId.make(\n    turn.id,\n  );\n",
      ["TurnId.make(\n    turn.id,\n  )"],
    ],
    [
      "a call whose argument nests parentheses",
      "const g = (turn: { id: string }) => TurnId.make(String(turn.id));\n",
      ["TurnId.make(String(turn.id)"],
    ],
  ];

  for (const [name, inserted, extra] of rows) {
    it(`counts ${name} as ${extra.length === 0 ? "no site" : "a site"}`, () => {
      assert.deepEqual(turnIdBrandSites(`${inserted}${base}`), [...extra, ...baseSites]);
    });
  }
});
