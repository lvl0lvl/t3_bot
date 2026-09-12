import { ChannelMemberHandle } from "@t3tools/contracts";
import { canonicalChannelHandle } from "@t3tools/shared/channelIdentity";

/**
 * The characters a handle cannot contain: whitespace and ASCII punctuation,
 * except `-` and `_`.
 *
 * ONE SET, USED FOR BOTH SIDES OF THE BOUNDARY, and that is the point rather
 * than tidiness. The first version of this listed the openers and the
 * terminators separately and they disagreed: thirteen characters could END a
 * handle but not BEGIN a mention. So `**@boss1** urgent`, `"@boss1" said` and
 * `` `@boss1` `` produced NO mention at all — the post was accepted, the
 * sidebar reordered, and the named member was never woken.
 *
 * That is worse than either failure alone, because it defeats the server's own
 * guard rather than tripping it. `requireChannelMentionsResolve` refuses a post
 * whose mention resolves to nobody precisely so a post cannot look sent while
 * waking nobody; a mention dropped HERE never reaches it, so nothing anywhere
 * reports the loss.
 *
 * `-` and `_` stay OUT of this set, so they are handle characters on both
 * sides: `@boss-1` parses as one handle, and the cost is that `-@walt` with no
 * space parses as none. A character cannot be both a handle character and a
 * boundary, and of the two readings "handles may contain hyphens" is the one a
 * roster actually needs.
 *
 * Written with doubled backslashes rather than as a `String.raw` template:
 * `String.raw` preserves the backslash a template literal needs before a
 * backtick, and `\\`` is an invalid escape inside a `u`-mode character class.
 */
const NON_HANDLE = "\\s!-,./:-@[-^`{-~";

/**
 * An "@" that starts a mention, and the handle that follows it.
 *
 * Built from `NON_HANDLE` twice — as the lookbehind, and negated as the handle
 * body — so the opener and the terminator are the same set by construction.
 *
 * A mention that resolves to nobody makes the decider refuse the entire post,
 * so over-collecting does not produce a stray mention: it loses the operator's
 * message. "email me at walt@example.com" sends nothing, because the "@" there
 * is preceded by a handle character and therefore begins no mention.
 */
const MENTION_PATTERN = new RegExp(`(?:^|(?<=[${NON_HANDLE}]))@([^${NON_HANDLE}]+)`, "gu");

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
