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
 * WHO KEEPS THE PRECONDITION, since the type cannot. `decodeChannelCursor`'s split is
 * correct only because a `ChannelId` cannot contain ":", and a bare `string` parameter
 * does not say that. Both callers satisfy it, by different means: the client door
 * passes an id that has already been decoded as a `ChannelId`, and the comms gateway
 * passes one its toolkit resolved from a channel lookup — it brands it one line later,
 * so the value is a real channel id before it reaches here rather than because of it.
 * A third caller holding an arbitrary string has to brand it first; nothing in this
 * signature will stop it, which is why the guarantee is written down.
 *
 * THE PAGING ARITHMETIC LIVES HERE TOO, for the reason above rather than as a
 * convenience: the over-fetch, which end of it to drop, which row the cursor comes
 * off, and whether there is a next page are four decisions that have to agree with
 * the format, and they were written twice in two styles. They agreed only while the
 * store returned exactly what LIMIT asked for.
 *
 * @module channelCursor
 */
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

/**
 * Which way a page reads, and therefore which way its cursor points.
 *
 * Named here because the cursor carries it: the format, the codec and the paging
 * arithmetic all have to agree about the two words, and this module is the one
 * home for the format (`t3_bot-2oh`).
 */
export type ChannelPostDirection = "forward" | "backward";

/**
 * WHY a cursor was refused, because the holder is told and the sentence has to be true.
 *
 * The refusal used to be one `Option.none` for three causes, and the comms toolkit's
 * one sentence named the cause it happened to be written for: an agent holding a
 * cursor THIS channel issued, for the other direction, was told the channel had not
 * issued it. The recovery is the same for all three, which is why the wrong reason
 * survived a review — the sentence read plausibly and its first clause was false
 * (`t3_bot-2oh`).
 *
 * A SCHEMA rather than a bare union because the two errors that carry it across the
 * seam are `Schema.TaggedError`s; declaring the three words there as well would be a
 * second spelling of this one, which is the drift `channelMemberRef.ts` exists to end.
 *
 * "malformed" is every shape failure, INCLUDING a cursor issued before the direction
 * segment existed: it has two parts where this decoder wants three, and its holder's
 * move is the same as for a truncated one.
 */
export const ChannelCursorRefusal = Schema.Literals(["malformed", "channel", "direction"]);
export type ChannelCursorRefusal = typeof ChannelCursorRefusal.Type;

/** A cursor carries the channel AND THE DIRECTION that issued it, which is what
 * makes one from elsewhere — or from the other direction — refusable. Paired with
 * `decodeChannelCursor`; neither is meaningful without the other, so they live
 * together. */
export const encodeChannelCursor = (
  channelId: string,
  direction: ChannelPostDirection,
  sequence: number,
): string => `${channelId}:${direction}:${sequence}`;

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
 * A FAILURE IS A REFUSAL AND NEVER AN EMPTY PAGE. Every caller has to translate
 * it into an error the holder can see; answering it with an empty page is the
 * original defect wearing the fix's clothes.
 *
 * THE FAILURE CARRIES WHICH REFUSAL IT WAS, because the holder is shown a
 * sentence and one shape for three causes made that sentence false for two of
 * them. `ChannelCursorRefusal` has the account.
 *
 * Split on the FIRST colon, which is correct only BECAUSE `t3_bot-2d2` forbids
 * ":" inside a `ChannelId` — so today the first and last colon are the same one
 * and the choice does not matter. It is not extra robustness: if that charset
 * ever widened, `indexOf` would take a channel id's own colon as the boundary
 * and `lastIndexOf` would take the sequence's. Neither is right without
 * re-deciding the format, and `CURSOR_PATTERN` in the comms `tools.ts` is where
 * the assumption is checkable.
 */
export const decodeChannelCursor = (
  channelId: string,
  direction: ChannelPostDirection,
  cursor: string,
): Result.Result<number, ChannelCursorRefusal> => {
  const boundary = cursor.indexOf(":");
  const issuedBy = cursor.slice(0, boundary);
  const rest = cursor.slice(boundary + 1);
  // ONE BOUNDARY CHECK, NOT TWO, and a guard sweep is what said so. There was a
  // `boundary === -1` refusal here and no input could reach it: with no colon,
  // `slice(boundary + 1)` is `slice(0)` — the whole string — and a string with
  // no colon has no SECOND colon either, so the check below refuses it anyway.
  // The mutation making the first check inert survived, which is what an
  // unreachable guard looks like rather than an untested one. Brute-forced over
  // every string of length 0..5 from {a, ":", 1}: 375 inputs, no disagreement.
  //
  // THIS one is on the same argument the module docstring makes about the first:
  // a `ChannelId` cannot contain ":" and a direction is one of two literal
  // words, so the boundaries are unambiguous. A cursor issued before this field
  // has ONE colon and lands here with no direction — refused rather than assumed
  // forward, because the assumption is unverifiable at the point of use. Every
  // cursor anyone holds today IS a forward cursor, so assuming would be right
  // every time and wrong never; a guard that is correct only by appeal to a
  // caller's current behaviour is the defect class this module exists for.
  const directionBoundary = rest.indexOf(":");
  if (directionBoundary === -1) {
    return Result.fail("malformed");
  }
  const issuedFor = rest.slice(0, directionBoundary);
  const digits = rest.slice(directionBoundary + 1);
  // DIGITS BEFORE `Number()`, because `Number()` is laxer than any schema that
  // feeds this and this function is also the door a direct caller uses.
  // `Number("")` is 0, `Number("0x2")` is 2, `Number(" 3 ")` is 3,
  // `Number("1e2")` is 100 — so `"<channel>:"` decoded to sequence 0 and the
  // read answered it with the FIRST PAGE. An empty-looking page that is really
  // "here is the start again" is the same lie, reachable at the seam rather
  // than through the tool.
  if (!/^[0-9]+$/.test(digits)) {
    return Result.fail("malformed");
  }
  const sequence = Number(digits);
  // BOTH halves, and the channel half first — which is now a decision a holder
  // can see rather than an ordering inside one boolean. A cursor wrong on both
  // axes is reported as the other channel's, because that is the cause the
  // holder has to act on: re-reading THIS channel the other way would still be
  // wrong. Compared EXACTLY — a length or prefix comparison passes every obvious
  // fixture and pages the wrong channel on a seeded install, where two channel
  // ids share a prefix and a length.
  if (issuedBy !== channelId) {
    return Result.fail("channel");
  }
  // THE DIRECTION IS THE OTHER AXIS OF THE SAME LIE (`t3_bot-2oh`). A cursor
  // points AFTER its page going forward and BEFORE it going backward, so the
  // same number means opposite things and neither read could tell which it was
  // handed. Measured on the live gateway over six posts, before the fix:
  //
  //   forward page1                      = [p1,p2]  cursor=<channel>:6
  //   that forward cursor, read BACKWARD = [p1]      cursor=null
  //   backward page1                     = [p5,p6]  cursor=<channel>:9
  //   that backward cursor, read FORWARD = [p6]      cursor=null
  //
  // Both answered `null`, the wire shape of "you are caught up", over four
  // unread posts each time.
  if (issuedFor !== direction) {
    return Result.fail("direction");
  }
  // "9007199254740993" is fifteen digits of nothing wrong and is not a safe
  // integer: `Number` rounds it to 9007199254740992, which is a sequence the
  // caller never held. A SHAPE failure rather than a provenance one — the
  // channel and the direction above are this channel's own.
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    return Result.fail("malformed");
  }
  return Result.succeed(sequence);
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
  readonly direction: ChannelPostDirection;
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
      more && edge !== undefined
        ? encodeChannelCursor(input.channelId, input.direction, edge.sequence)
        : null,
  };
};
