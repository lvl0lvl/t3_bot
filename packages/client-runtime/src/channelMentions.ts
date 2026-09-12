import { ChannelMemberHandle } from "@t3tools/contracts";
import { canonicalChannelHandle } from "@t3tools/shared/channelIdentity";

/**
 * An "@" that STARTS a mention: at the beginning of the body, or after
 * whitespace or an opening bracket.
 *
 * The boundary is the whole rule. A mention that resolves to nobody makes the
 * decider refuse the entire post, so over-collecting does not produce a stray
 * mention — it loses the operator's message. "email me at walt@example.com"
 * would otherwise send "example.com" as a mention and the post would come back
 * refused with nothing obviously wrong in what was typed.
 *
 * The handle runs to the first whitespace or the first character that reads as
 * punctuation around a mention rather than part of one. Sentence punctuation has
 * to terminate ("@walt." at the end of a sentence is a mention of walt), which
 * means a handle cannot contain those characters — acceptable, since the seeded
 * handles are words, and a handle that needs a comma cannot be typed in prose at
 * all.
 */
const MENTION_PATTERN = /(?:^|(?<=[\s([{<]))@([^\s([{<>)\]},.;:!?"'`]+)/gu;

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
