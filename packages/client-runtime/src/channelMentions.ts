import { ChannelMemberHandle } from "@t3tools/contracts";
import { canonicalChannelHandle } from "@t3tools/shared/channelIdentity";

/**
 * What cannot appear in a handle: whitespace, punctuation, and the symbol
 * categories that are not emoji.
 *
 * ONE SET FOR BOTH SIDES OF THE BOUNDARY, and that is the point rather than
 * tidiness. The first version listed openers and terminators separately and they
 * disagreed: thirteen characters could END a handle but not BEGIN a mention, so
 * `**@boss1** urgent` produced NO mention, the post was accepted, and the member
 * was never woken.
 *
 * The second version used ONE set but wrote it as an ASCII range list, which
 * terminated ASCII punctuation only. An em-dash or a curly quote then ran into
 * the handle — `over to @boss1—he` gave "boss1—he" — and an unresolvable mention
 * makes the decider refuse the WHOLE post. macOS substitutes `—` for `--` as you
 * type and the copy in this repo uses curly quotes, so both arrive without
 * anyone trying. Unicode categories are the version that does not have a third
 * such gap waiting in it.
 *
 * WHY EACH CATEGORY, since the choice is the whole behaviour:
 *   `\p{P}`  punctuation — brackets, quotes, dashes, ellipsis, CJK marks. Out.
 *   `\p{Sm}` math symbols — `<`, `>`, `+`. Out, so `<@boss1>` parses.
 *   `\p{Sc}` currency and `\p{Sk}` modifier symbols. Out, same reason.
 *   `\p{So}` OTHER symbols is deliberately NOT here: emoji live there, and
 *            `channelIdentity` records refusing emoji handles as a regression it
 *            had to undo. A boundary wider than the roster it parses against
 *            would drop `@🔥` silently, which is the same failure in new clothes.
 *
 * `-` and `_` are `\p{Pd}` and `\p{Pc}`, so they are carved back IN by the
 * second lookbehind and the handle's alternation: they are handle characters on
 * BOTH sides, `@boss-1` is one handle, and the cost is that `-@walt` with no
 * space is not a mention. A character cannot be both a handle character and a
 * boundary, and of the two readings a roster needs hyphens.
 */
const BOUNDARY = String.raw`[\s\p{P}\p{Sm}\p{Sc}\p{Sk}]`;
const HANDLE_CHAR = String.raw`(?:[-_]|[^\s\p{P}\p{Sm}\p{Sc}\p{Sk}])`;

/**
 * An "@" that starts a mention, and the handle that follows it.
 *
 * A mention that resolves to nobody makes the decider refuse the entire post, so
 * over-collecting does not produce a stray mention: it loses the operator's
 * message. "email me at walt@example.com" sends nothing, because the "@" there
 * is preceded by a handle character and so begins no mention.
 */
const MENTION_PATTERN = new RegExp(
  String.raw`(?:^|(?<=${BOUNDARY})(?<![-_]))@(${HANDLE_CHAR}+)`,
  "gu",
);

/**
 * The mention keys in a post body, canonical and deduplicated.
 *
 * Canonical rather than as-typed because `mentions` is an identity list, not a
 * record of what the operator wrote — the body already carries that. The
 * canonical form comes from `@t3tools/shared`, the one place that rule lives, so
 * this agrees with the decider by construction rather than by two
 * implementations happening to match.
 *
 * The decider canonicalises and dedupes again on receipt, which is correct and
 * not redundant: doing it here makes the wire carry keys, and doing it there
 * makes the rule hold for every caller including the ones that are not this UI.
 *
 * A handle of only sigils ("@@@") canonicalises to empty and is dropped rather
 * than sent — the decider would refuse it, and refusing the whole post because
 * someone typed a row of at-signs is worse than treating it as prose.
 */
export function mentionedHandles(body: string): ReadonlyArray<ChannelMemberHandle> {
  const canonical = new Set<string>();
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const handle = canonicalChannelHandle(match[1] ?? "");
    if (handle.length > 0) {
      canonical.add(handle);
    }
  }
  // `.make` throws on a handle the brand refuses, and the brand's predicate is
  // "trimmed and non-empty": the pattern captures no whitespace, and the length
  // check above is the non-empty half. Whether the handle names a MEMBER is the
  // server's question and this cannot answer it — the client is not sent the
  // roster, deliberately.
  return [...canonical].map((handle) => ChannelMemberHandle.make(handle));
}
