/**
 * The canonical form of a channel name and of a member handle.
 *
 * ONE implementation, imported by both sides of the comms seam: the decider,
 * which decides what is STORED, and the MCP toolkit, which decides what a
 * lookup SEARCHES for. It lives here rather than next to either because a
 * second copy is the actual defect — the two diverged three times in one
 * evening (a single sigil versus a run of them, case folding, then NFC), and
 * every time both sides' tests stayed green, because a copy agrees with itself.
 *
 * The failure is silent and shaped like an authorization denial: a name lookup
 * that misses is deliberately indistinguishable from "you are not a member", so
 * an agent cannot tell a typo from exclusion, and an operator cannot tell a
 * broken canonicaliser from a permissions problem.
 */

/**
 * Characters that must never reach a stored name or handle.
 *
 * `String.trim()` removes 25 code points and no control or format character, so
 * "non-empty after trimming" admits a handle of one zero-width space, and an
 * invisible-prefixed "boss1" that renders exactly like the real one. It also
 * admits ANSI escapes, and both names and handles are echoed back to agent and
 * CLI output — a stored name carrying a screen-clear sequence is a terminal
 * write, not a label.
 *
 * `\p{C}` covers control, format, surrogate, private-use and unassigned. The
 * separators and U+034F are listed because they fall outside it; U+034F is a
 * combining mark. Confusables are deliberately absent: Cyrillic "о" is a real
 * letter, and rejecting it would refuse legitimate names.
 */
export const FORBIDDEN_IN_CANONICAL_IDENTITY = /[\p{C}\p{Zl}\p{Zp}͏]/u;

/**
 * NFC, then trim, strip leading sigils, trim again, repeat to a fixpoint, then
 * lowercase.
 *
 * The repeat is what carries "# #seniors" to "seniors": one pass leaves
 * "#seniors", which canonicalises again to something else, so a stored name
 * would not match itself. Each pass strictly shortens the value or ends the
 * loop, so it terminates.
 *
 * NFC is not defensive, it is what makes the output a canonical FORM: composed
 * "é" and decomposed "e" + U+0301 are the same text and must be one identity.
 * It does NOT fold compatibility characters — NFKC would rewrite them wholesale
 * — so two identities can still render alike. That is bounded elsewhere, by
 * membership changes requiring a human or system issuer.
 */
function canonicalise(value: string, sigil: RegExp): string {
  let current = value.normalize("NFC").trim();
  for (;;) {
    const next = current.replace(sigil, "").trim();
    if (next === current) {
      return current.toLowerCase();
    }
    current = next;
  }
}

/** The canonical channel name. "#Seniors", "## seniors" and "seniors" are one. */
export function canonicalChannelName(name: string): string {
  return canonicalise(name, /^#+/);
}

/** The same rule with "@": "@Boss1" and "boss1" are one mention key. */
export function canonicalChannelHandle(handle: string): string {
  return canonicalise(handle, /^@+/);
}

/**
 * Whether a canonical value is storable: non-empty and free of invisibles.
 *
 * Callers that store take this as a gate. Callers that only look something up
 * do not need it — a value that cannot be stored also cannot be found, so the
 * lookup misses on its own.
 */
export function isStorableCanonicalIdentity(canonical: string): boolean {
  return canonical.length > 0 && !FORBIDDEN_IN_CANONICAL_IDENTITY.test(canonical);
}

/** The first forbidden code point in a value, as "U+XXXX", for an error message. */
export function describeForbiddenIdentityCharacter(value: string): string {
  const found = [...value].find((character) => FORBIDDEN_IN_CANONICAL_IDENTITY.test(character));
  return found === undefined
    ? "an invisible character"
    : `U+${found.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`;
}
