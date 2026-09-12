/**
 * There is exactly ONE canonicaliser behind the comms seam.
 *
 * Two implementations of one rule diverged four times in a single evening: how
 * many leading sigils a name loses, whether a handle folds case, NFC, and then
 * NFC's position relative to the fold. Every time, both sides' own tests stayed
 * green, because a copy agrees with itself.
 *
 * The last of those four is the one this file is shaped around. It did not come
 * from anyone disagreeing — it came from one side being IMPROVED. So "the two
 * agree" is not the property worth guarding; the copies agreeing today says
 * nothing about tomorrow, and nothing in either file announces that the other
 * moved. The property is that THERE IS ONLY ONE.
 */
import { canonicalChannelHandle, canonicalChannelName } from "@t3tools/shared/channelIdentity";
import { expect, it } from "@effect/vitest";

import {
  canonicalChannelHandle as toolkitCanonicalChannelHandle,
  canonicalChannelName as toolkitCanonicalChannelName,
} from "./handlers.ts";

/**
 * REFERENCE equality, not behavioural.
 *
 * This is the whole point and it is why this test does not go vacuous once the
 * copies are merged. A behavioural comparison passes the moment two separate
 * functions happen to agree, and then silently stops meaning anything — it was
 * green through all four divergences at the moments they matched. Comparing the
 * function OBJECT fails for a second implementation even when that
 * implementation is byte-for-byte correct, which is the state to prevent: a copy
 * that is right today is a copy that can be improved out of agreement tomorrow.
 */
it("exposes the shared canonicaliser itself, not a copy of it", () => {
  expect(
    toolkitCanonicalChannelName,
    "the toolkit defines its own canonicalChannelName again — import it from @t3tools/shared/channelIdentity instead",
  ).toBe(canonicalChannelName);
  expect(
    toolkitCanonicalChannelHandle,
    "the toolkit defines its own canonicalChannelHandle again — import it from @t3tools/shared/channelIdentity instead",
  ).toBe(canonicalChannelHandle);
});

/**
 * The rows the skew was found on, kept as a DIAGNOSTIC rather than a guard.
 *
 * With one implementation these pass trivially — the test above is what has
 * teeth. They are here so that when someone reintroduces a copy, the failure
 * above tells them THAT and these tell them WHICH INPUTS moved, by code point,
 * without their having to rediscover the set. Every row below is an input where
 * the two implementations actually disagreed on 2026-09-12.
 */
const SKEW_ROWS: ReadonlyArray<readonly [input: string, canonical: string]> = [
  // The sigil rows, which are what the "#" -> "@" derivation below actually
  // exercises. Every other row here is sigil-free, so without these the handle
  // test is the name test wearing a different title.
  ["#ops", "ops"],
  ["## ops", "ops"],
  ["# #ops", "ops"],
  // NFC after the fold, not before: lowercasing can make a sequence newly
  // composable, so "H" + U+0331 must reach the precomposed U+1E96.
  ["H̱", "ẖ"],
  ["J̌", "ǰ"],
  // Whitespace collapsed: a no-break space and a plain space are one identity.
  ["a b", "a b"],
  ["my  channel", "my channel"],
  // A CJK ideographic space is a space. The canonical form is an identity key,
  // not a display name — the same licence lowercasing already takes.
  ["名前　テスト", "名前 テスト"],
];

it("agrees with the shared rule on every input the skew was found on", () => {
  const rendered = SKEW_ROWS.map(([input]) => `${input} -> ${toolkitCanonicalChannelName(input)}`);
  const expected = SKEW_ROWS.map(([input, canonical]) => `${input} -> ${canonical}`);
  expect(rendered).toEqual(expected);
});

it("keeps the handle rows too, since the sigil is the only difference", () => {
  // Derived rather than retyped: a row added above is asserted on both paths and
  // there is no second list to forget. Retyping is how two lists that are meant
  // to be identical stop being identical.
  //
  // The derivation was a NO-OP until the sigil rows were added above - no row
  // contained a "#", so replaceAll("#", "@") renamed nothing and this test
  // asserted the name rule a second time under a different name. Shown by
  // mutation: replaceAll("q", "z") left all three tests green.
  const handleRows = SKEW_ROWS.map(
    ([input, canonical]) => [input.replaceAll("#", "@"), canonical.replaceAll("#", "@")] as const,
  );
  const rendered = handleRows.map(
    ([input]) => `${input} -> ${toolkitCanonicalChannelHandle(input)}`,
  );
  const expected = handleRows.map(([input, canonical]) => `${input} -> ${canonical}`);
  expect(rendered).toEqual(expected);
});
