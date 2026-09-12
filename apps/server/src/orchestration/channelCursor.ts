/**
 * The opaque post-page cursor, encoded and decoded in ONE place.
 *
 * Lifted out of `channelGatewayLive.ts` unchanged when the browser gained a
 * paged read, because two doors decoding the same format is two chances to
 * disagree about it — and this format's failure mode is a lie rather than an
 * error. `decodeChannelCursor` below carries the account of that, with the
 * measurement; every other mention of it in the tree is a clause pointing here.
 *
 * `channelId` is a `string` here rather than `ChannelId` because the comms
 * gateway's seam stages its ids as strings; the client door brands them and
 * passes the brand's underlying string in. Both callers get the same decisions.
 *
 * THE PAGING ARITHMETIC LIVES HERE TOO, for the reason above rather than as a
 * convenience: the over-fetch, which end of it to drop, which row the cursor comes
 * off, and whether there is a next page are four decisions that have to agree with
 * the format, and they were written twice in two styles. They agreed only while the
 * store returned exactly what LIMIT asked for.
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

/**
 * How many rows to ask the store for when the caller wants `limit` of them.
 *
 * ONE MORE THAN ASKED FOR. `nextCursor` has to say whether another post exists in
 * that direction, and the extra row answers it without a second query — the row
 * itself is never returned to the caller.
 */
export const channelPostOverFetch = (limit: number): number => limit + 1;

/**
 * Which of the over-fetched rows are the page, and the cursor to continue from.
 *
 * Takes the rows the store returned ASCENDING in both directions, which is what
 * `listPosts` and `listPostsBackward` both promise, and returns rows rather than
 * posts: the two doors map a row to a different shape, and the gateway's drops
 * `sequence`, so the cursor has to be taken here while the row still carries one.
 *
 * BACKWARD DROPS FROM THE FRONT. Going backward the over-fetched row is the OLDEST
 * one and going forward the NEWEST, so slicing the tail in both directions would
 * discard the post the caller asked for and keep the probe — a channel rendered one
 * post behind itself.
 *
 * `rows.length - limit` rather than `slice(-limit)`, which are the same expression
 * for every limit but one: `slice(-0)` is `slice(0)` and returns the WHOLE
 * over-fetched array, so a limit of zero would answer with a post the caller
 * declined to ask for.
 */
export const resolveChannelPostPage = <A extends { readonly sequence: number }>(input: {
  readonly channelId: string;
  readonly direction: "forward" | "backward";
  readonly limit: number;
  readonly rows: ReadonlyArray<A>;
}): { readonly rows: ReadonlyArray<A>; readonly nextCursor: string | null } => {
  // `>` rather than `=== overFetch`: the question is whether more rows exist than
  // the caller wanted, and a store that ever returned two extra would answer the
  // equality with "no more pages" — the caught-up lie this module exists to stop.
  const more = input.rows.length > input.limit;
  const rows = more
    ? input.direction === "backward"
      ? input.rows.slice(input.rows.length - input.limit)
      : input.rows.slice(0, input.limit)
    : input.rows;
  // Forward points AFTER the last row returned; backward points BEFORE the first.
  const edge = input.direction === "backward" ? rows[0] : rows[rows.length - 1];
  return {
    rows,
    nextCursor:
      more && edge !== undefined ? encodeChannelCursor(input.channelId, edge.sequence) : null,
  };
};
