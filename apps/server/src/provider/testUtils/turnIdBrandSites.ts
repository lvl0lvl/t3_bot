// The one definition of "a literal `TurnId.make(` call outside a comment-only
// line", shared by the two source-reading pins (`OpenCodeAdapter.test.ts`,
// `CodexSessionRuntime.ingestion.integration.test.ts`). The strip was
// introduced in #53 (OpenCode), copied and fixed in #54 (Codex; the OpenCode
// copy stayed on #53's form), and the fix carried to OpenCode in #56 — a second
// PR for one fix; `OpenCodeAdapter.test.ts` is also the file upstream edits
// most. This file has no upstream history.
//
// A line is a comment only when no code follows its `*/`: `/* note */ const x`
// and a block closed as ` */ const x` both keep their code, so a call after
// either still counts. A same-line comment after code or after another comment
// (`/* a */ // TurnId.make(id)`), and a string literal, are counted too — a pin
// reds and the comment is reworded, not listed. Stripped by line, not by
// content: a `/*` inside a string (`const s = "/*";`) would let a content
// strip eat the code after it. What is NOT seen: a cast
// `as TurnId`, a longer identifier ending in `TurnId` (`FooTurnId.make(`), an
// aliased or destructured `make`, a `.call`/`.apply`/`.bind` on it, a bracket
// access, a call with whitespace around the `.` or before the `(`
// (`TurnId .make(`, `.make` on the next line — `vp fmt` closes those), and a
// same-string call moved to another site (the pin sees which strings, in what
// order, not which line).
const COMMENT_ONLY_LINE = /^\s*(?:\/\/|(?!.*\*\/[ \t]*\S)(?:\/\*|\*)).*$/gm;
const TURN_ID_MAKE_CALL = /\bTurnId[?!]?\.make\([^)]*\)/g;

/**
 * The literal `TurnId.make(…)` (or `TurnId?.make`, `TurnId!.make`) calls in `source`, in order,
 * comment-only lines removed; each element runs from `TurnId` to the first `)`, so a call whose
 * argument nests parentheses is counted but listed as that prefix (`TurnId.make(String(x))` →
 * `TurnId.make(String(x)`).
 */
export const turnIdBrandSites = (source: string): ReadonlyArray<string> =>
  source.replace(COMMENT_ONLY_LINE, "").match(TURN_ID_MAKE_CALL) ?? [];
