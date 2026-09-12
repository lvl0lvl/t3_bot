/**
 * The opaque post-page cursor, encoded and decoded in ONE place.
 *
 * Lifted out of `channelGatewayLive.ts` unchanged when the browser gained a
 * paged read, because two doors decoding the same format is two chances to
 * disagree about it — and this format's failure mode is a lie rather than an
 * error: a cursor the reader does not accept, answered with an empty page, is
 * byte for byte what "you are caught up" looks like. The comments below are the
 * reasons the toolkit's version holds, kept with the code they explain.
 *
 * `channelId` is a `string` here rather than `ChannelId` because the comms
 * gateway's seam stages its ids as strings; the client door brands them and
 * passes the brand's underlying string in. Both callers get the same decisions.
 *
 * @module channelCursor
 */
import * as Option from "effect/Option";

/** A cursor carries the channel that issued it, which is what makes one from
 * elsewhere refusable. Paired with `decodeChannelCursor`; neither is meaningful
 * without the other, so they live together. */
export const encodeChannelCursor = (channelId: string, sequence: number): string =>
  `${channelId}:${sequence}`;

/**
 * A cursor names the channel it came from, and one from elsewhere is REFUSED.
 *
 * It used to be the bare event sequence. That sequence is GLOBAL, so a cursor
 * earned in another channel was well-formed digits that matched no row here, and
 * the read returned an empty page with `nextCursor: null` — byte for byte the
 * answer for "you are caught up". Measured before the fix: a second channel
 * holding three unread posts reported itself caught up to a caller holding the
 * first channel's cursor, and nothing in the reply said otherwise (`t3_bot-e60`).
 *
 * `None` IS A REFUSAL AND NEVER AN EMPTY PAGE. Every caller has to translate it
 * into an error the holder can see; answering it with an empty page is the
 * original defect wearing the fix's clothes.
 *
 * Split on the FIRST colon, which is correct only BECAUSE `t3_bot-2d2` forbids
 * ":" inside a `ChannelId` — so today the first and last colon are the same one
 * and the choice does not matter. It is not extra robustness: if that charset
 * ever widened, `indexOf` would take a channel id's own colon as the boundary
 * and `lastIndexOf` would take the sequence's. Neither is right without
 * re-deciding the format, and `CURSOR_PATTERN` in the comms `tools.ts` is where
 * the assumption is checkable.
 */
export const decodeChannelCursor = (channelId: string, cursor: string): Option.Option<number> => {
  const boundary = cursor.indexOf(":");
  if (boundary === -1) {
    return Option.none<number>();
  }
  const issuedBy = cursor.slice(0, boundary);
  const digits = cursor.slice(boundary + 1);
  // DIGITS BEFORE `Number()`, because `Number()` is laxer than any schema that
  // feeds this and this function is also the door a direct caller uses.
  // `Number("")` is 0, `Number("0x2")` is 2, `Number(" 3 ")` is 3,
  // `Number("1e2")` is 100 — so `"<channel>:"` decoded to sequence 0 and the
  // read answered it with the FIRST PAGE. An empty-looking page that is really
  // "here is the start again" is the same lie, reachable at the seam rather
  // than through the tool.
  if (!/^[0-9]+$/.test(digits)) {
    return Option.none<number>();
  }
  const sequence = Number(digits);
  // BOTH halves, and the channel half first: a cursor for another channel is
  // the defect this exists for, and a caller that gets the right refusal for
  // the wrong reason has learned nothing. Compared EXACTLY — a length or prefix
  // comparison passes every obvious fixture and pages the wrong channel on a
  // seeded install, where two channel ids share a prefix and a length.
  if (issuedBy !== channelId || !Number.isSafeInteger(sequence) || sequence < 0) {
    return Option.none<number>();
  }
  return Option.some(sequence);
};
