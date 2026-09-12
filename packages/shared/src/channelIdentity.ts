/**
 * The canonical form of a channel name and of a member handle.
 *
 * The one place this rule is allowed to live. The decider imports it today. The
 * MCP toolkit does NOT yet — it still carries its own copy, and replacing that
 * copy with this import is `t3_bot-iin`. Until then this module is the single
 * source for one of the two sides, which is half of the point.
 *
 * It lives here rather than next to either side because a second copy is the
 * actual defect — the two diverged three times in one
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
 * `\p{C}` covers control, format, surrogate, private-use and unassigned, and
 * `Default_Ignorable_Code_Point` covers the invisibles outside it — the Hangul
 * and halfwidth fillers, the Khmer inherent vowels. Variation selectors are also
 * in that property but never reach here: canonicalise strips them first, because
 * refusing them broke emoji handles. U+034F is listed separately (a combining mark) and so is
 * U+2800, BRAILLE PATTERN BLANK, an ordinary symbol that renders as nothing.
 *
 * `\p{C}` alone was not enough: a handle of "boss1" plus one variation selector
 * stored as a second member rendering identically to the first.
 *
 * Confusables are deliberately absent: Cyrillic "о" is a real letter, and
 * rejecting it would refuse legitimate names. Exotic SPACES are not here either —
 * they are collapsed rather than refused, see canonicalise.
 */
export const FORBIDDEN_IN_CANONICAL_IDENTITY =
  /[\p{C}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u034F\u2800]/u;

/**
 * Collapse whitespace runs to one plain space, strip leading sigils to a
 * fixpoint, lowercase, and normalise to NFC LAST.
 *
 * The fixpoint carries "# #seniors" to "seniors": one pass leaves "#seniors",
 * which canonicalises again to something else, so a stored name would not match
 * itself. Each pass strictly shortens the value or ends the loop.
 *
 * NFC IS THE FINAL STEP, and the order is the whole point. Lowercasing can
 * produce a newly composable sequence, so normalising first and folding second
 * leaves output that is NOT in NFC: "H" + U+0331 folded to "h" + U+0331 while a
 * roster held the precomposed U+1E96, and the two stored as separate members
 * rendering identically. Normalising after the fold makes them one identity and
 * makes this function idempotent, which is what "canonical" has to mean — a
 * stored value must canonicalise to itself.
 *
 * Whitespace is COLLAPSED and variation selectors are STRIPPED, rather than
 * either being refused: a no-break space and a plain space are one identity
 * instead of two that render alike, "my  channel" reaches "my channel", and
 * "boss1" + U+FE0F reaches "boss1" so it collides with the real member instead
 * of storing beside it. Refusing them rejected legitimate input — emoji handles
 * — to fix a spoofing problem that normalising solves outright.
 *
 * It does NOT fold compatibility characters or confusables — NFKC would rewrite
 * them wholesale — so two identities can still render alike. That is bounded
 * elsewhere, by membership changes requiring a human or system issuer.
 */
/**
 * Variation selectors, which are STRIPPED rather than refused.
 *
 * Refusing them was a regression I introduced: U+FE0F is how emoji presentation
 * is requested, so "❤️" (U+2764 U+FE0F) and "1️⃣" stopped being storable handles
 * while plain "🔥" still was. Stripping keeps them working — "❤️" stores as
 * U+2764 in text presentation — and still closes the spoof they were refused
 * for, by a better route: "boss1" + U+FE0F now canonicalises to "boss1" and
 * COLLIDES with the real member, so the uniqueness check refuses it instead of
 * two identical-looking members both storing.
 *
 * The same move as collapsing whitespace: normalise the difference away rather
 * than reject the input that contains it. Zero-width JOINER is NOT here — it
 * changes which grapheme is produced, so stripping it would rewrite the name;
 * it stays refused, as it was before any of this.
 */
const VARIATION_SELECTORS = /[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu;

function canonicalise(value: string, sigil: RegExp): string {
  let current = value.replace(VARIATION_SELECTORS, "").replace(/\s+/gu, " ").trim();
  for (;;) {
    const next = current.replace(sigil, "").trim();
    if (next === current) {
      return current.toLowerCase().normalize("NFC");
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
