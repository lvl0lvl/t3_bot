import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";

import {
  channelPostOverFetch,
  resolveChannelPostPage,
  decodeChannelCursor,
  encodeChannelCursor,
} from "./channelCursor.ts";

/**
 * The page arithmetic, tested where the inputs the doors cannot produce are reachable.
 *
 * Both doors ask the store for `limit + 1` rows and the store honours LIMIT, so
 * through either door `rows.length > limit` and `rows.length === limit + 1` are the
 * same predicate — which is exactly how the two copies of this arithmetic agreed
 * with each other while being written differently (`QUAL-25-07`). A mutation
 * swapping one for the other survived a sweep through both doors.
 *
 * Calling the function directly is what distinguishes them: it takes the rows it is
 * given, so a third row can exist. That is the reason these cases are here and not
 * in `channelPosts.test.ts` — not because a pure function deserves a unit test.
 */
const row = (sequence: number) => ({ sequence, id: `post-${sequence}` });

describe("resolveChannelPostPage", () => {
  it("reports more when the store returned MORE than one extra row", () => {
    // `=== limit + 1` answers "no more pages" here, and a page that says it is the
    // last one when it is not is the caught-up lie `decodeChannelCursor`'s whole
    // docstring is about — arrived at from the opposite end. Nothing in the
    // repository returns three rows for a limit of one today; the predicate is
    // still the difference between asking the right question and asking one that
    // happens to have the same answer.
    const page = resolveChannelPostPage({
      channelId: "channel-a",
      direction: "backward",
      limit: 1,
      rows: [row(1), row(2), row(3)],
    });
    expect(page.rows).toEqual([row(3)]);
    expect(page.nextCursor).toBe("channel-a:3");
  });

  it("keeps the NEWEST rows going backward and the oldest going forward", () => {
    const rows = [row(1), row(2), row(3)];
    // Both reads return ascending, so the over-fetched row is at the opposite end
    // in each direction. Slicing the tail in both would return the probe and drop
    // the post the caller asked for.
    expect(
      resolveChannelPostPage({ channelId: "c", direction: "backward", limit: 2, rows }).rows,
    ).toEqual([row(2), row(3)]);
    expect(
      resolveChannelPostPage({ channelId: "c", direction: "forward", limit: 2, rows }).rows,
    ).toEqual([row(1), row(2)]);
  });

  it("points the cursor at the edge the next read continues from", () => {
    // FOUR ROWS AND A LIMIT OF TWO, chosen from the property rather than for
    // roundness. Three rows and a limit of two keep `[5,6]` backward and `[4,5]`
    // forward, whose edges are BOTH row 5 — so the two ends produce the same cursor
    // and swapping them changes nothing. A limit of one is worse: the first and last
    // kept row are the same row.
    const rows = [row(4), row(5), row(6), row(7)];
    // Backward continues BEFORE the oldest row on screen; forward continues AFTER
    // the newest. Taking the other end points the next read back into the page just
    // returned, and paging repeats it forever.
    expect(
      resolveChannelPostPage({ channelId: "c", direction: "backward", limit: 2, rows }).nextCursor,
    ).toBe("c:6");
    expect(
      resolveChannelPostPage({ channelId: "c", direction: "forward", limit: 2, rows }).nextCursor,
    ).toBe("c:5");
  });

  it("says there is no next page when the store returned no extra row", () => {
    const page = resolveChannelPostPage({
      channelId: "c",
      direction: "backward",
      limit: 2,
      rows: [row(1), row(2)],
    });
    expect(page.rows).toEqual([row(1), row(2)]);
    expect(page.nextCursor).toBeNull();
  });

  it("returns nothing for a limit of zero", () => {
    // THE ONE LIMIT WHERE `slice(-limit)` DIFFERS: `slice(-0)` is `slice(0)`, which
    // returns the whole over-fetched array — so the caller that asked for no posts
    // would be handed one, with a cursor as though it had paged. No schema admits a
    // zero limit today, which is why this is the only place the difference shows.
    const page = resolveChannelPostPage({
      channelId: "c",
      direction: "backward",
      limit: 0,
      rows: [row(1)],
    });
    expect(page.rows).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});

describe("channelPostOverFetch", () => {
  it("asks for one more row than the caller wanted", () => {
    // The extra row is how `nextCursor` is answered without a second query, and it
    // is never returned: `resolveChannelPostPage` drops it.
    expect(channelPostOverFetch(50)).toBe(51);
    const page = resolveChannelPostPage({
      channelId: "c",
      direction: "backward",
      limit: 1,
      rows: [row(1), row(2)],
    });
    expect(page.rows).toHaveLength(1);
  });
});

describe("channelCursor", () => {
  it("round-trips a cursor the encoder produced", () => {
    expect(
      Option.getOrNull(decodeChannelCursor("channel-a", encodeChannelCursor("channel-a", 7))),
    ).toBe(7);
  });

  it("refuses a cursor another channel issued", () => {
    // The defect this module exists for: the sequence is GLOBAL, so a cursor earned
    // elsewhere is well-formed digits matching no row here, and answering it with an
    // empty page is byte for byte "you are caught up" (`t3_bot-e60`).
    expect(
      Option.isNone(decodeChannelCursor("channel-b", encodeChannelCursor("channel-a", 7))),
    ).toBe(true);
  });

  it("refuses digits that are not digits", () => {
    // `Number()` is laxer than any schema feeding this, and this function is also
    // the door a direct caller uses: `Number("")` is 0, so `"channel-a:"` decoded to
    // sequence 0 and the read answered it with the FIRST PAGE.
    for (const cursor of ["channel-a:", "channel-a:0x2", "channel-a: 3 ", "channel-a:1e2", "7"]) {
      expect(Option.isNone(decodeChannelCursor("channel-a", cursor))).toBe(true);
    }
  });

  it("accepts sequence zero when it is written as a digit", () => {
    // Distinct from the case above: the refusal is for text that is not a number,
    // not for the number zero, which is a legitimate sequence.
    expect(Option.getOrNull(decodeChannelCursor("channel-a", "channel-a:0"))).toBe(0);
  });
});
