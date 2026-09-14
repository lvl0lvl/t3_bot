// The one definition of "a literal `TurnId.make(` call outside a comment-only
// line", shared by the two source-reading pins (`OpenCodeAdapter.test.ts`,
// `CodexSessionRuntime.ingestion.integration.test.ts`). The strip was revised
// three times while it lived in both files (#53, #54, #56), each fix after the
// first needing a second PR to reach the other copy; `OpenCodeAdapter.test.ts`
// is also the file upstream edits most. This file has no upstream history.
//
// A line is a comment only when no code follows its `*/`: `/* note */ const x`
// and a block closed as ` */ const x` both keep their code, so a call after
// either still counts. A same-line comment after code or after another comment
// (`/* a */ // TurnId.make(id)`), and a string literal, are counted too — a pin
// reds and the comment is reworded, not listed. What is NOT seen: a cast
// `as TurnId`, an aliased or destructured `make`, a `.call`/`.apply`/`.bind`
// on it, a bracket access, and a same-string call moved to another site (the
// pin sees which strings, in what order, not which line).
const COMMENT_ONLY_LINE = /^\s*(?:\/\/|(?!.*\*\/[ \t]*\S)(?:\/\*|\*)).*$/gm;
const TURN_ID_MAKE_CALL = /TurnId[?!]?\.make\([^)]*\)/g;

/** The literal `TurnId.make(…)` (or `TurnId?.make`, `TurnId!.make`) calls in `source`, in order, comment-only lines removed. */
export const turnIdBrandSites = (source: string): ReadonlyArray<string> =>
  source.replace(COMMENT_ONLY_LINE, "").match(TURN_ID_MAKE_CALL) ?? [];
