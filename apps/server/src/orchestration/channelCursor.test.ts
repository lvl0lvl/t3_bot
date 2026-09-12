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
    expect(page.nextCursor).toBe("channel-a:backward:3");
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
    ).toBe("c:backward:6");
    expect(
      resolveChannelPostPage({ channelId: "c", direction: "forward", limit: 2, rows }).nextCursor,
    ).toBe("c:forward:5");
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
      Option.getOrNull(
        decodeChannelCursor("channel-a", "forward", encodeChannelCursor("channel-a", "forward", 7)),
      ),
    ).toBe(7);
    expect(
      Option.getOrNull(
        decodeChannelCursor(
          "channel-a",
          "backward",
          encodeChannelCursor("channel-a", "backward", 7),
        ),
      ),
    ).toBe(7);
  });

  it("refuses a cursor another channel issued", () => {
    // The defect this module exists for: the sequence is GLOBAL, so a cursor earned
    // elsewhere is well-formed digits matching no row here, and answering it with an
    // empty page is byte for byte "you are caught up" (`t3_bot-e60`).
    expect(
      Option.isNone(
        decodeChannelCursor("channel-b", "forward", encodeChannelCursor("channel-a", "forward", 7)),
      ),
    ).toBe(true);
  });

  it("refuses a cursor the OTHER DIRECTION issued", () => {
    // The same lie on the other axis (`t3_bot-2oh`): a cursor points AFTER its
    // page going forward and BEFORE it going backward, so the same number means
    // opposite things and the read cannot tell which it was handed. Measured on
    // the live gateway before the fix: a forward cursor read backward answered
    // with an early page and `nextCursor: null` over four unread posts.
    expect(
      Option.isNone(
        decodeChannelCursor(
          "channel-a",
          "backward",
          encodeChannelCursor("channel-a", "forward", 7),
        ),
      ),
    ).toBe(true);
    expect(
      Option.isNone(
        decodeChannelCursor(
          "channel-a",
          "forward",
          encodeChannelCursor("channel-a", "backward", 7),
        ),
      ),
    ).toBe(true);
  });

  it("refuses a cursor issued before the direction existed", () => {
    // THE DEPLOY WINDOW. Every cursor a holder is carrying right now has two
    // segments, and every one of them IS a forward cursor, because the only
    // issuer hardcodes forward — so "assume forward" would be right every time
    // and wrong never. Refused anyway: the assumption is unverifiable at the
    // point of use, and a guard correct only by appeal to a caller's current
    // behaviour is the defect class this module exists for. A refusal costs a
    // re-read; a wrong page costs the posts the caller never learns it missed.
    expect(Option.isNone(decodeChannelCursor("channel-a", "forward", "channel-a:7"))).toBe(true);
  });

  it("refuses digits that are not digits", () => {
    // `Number()` is laxer than any schema feeding this, and this function is also
    // the door a direct caller uses: `Number("")` is 0, so `"channel-a:"` decoded to
    // sequence 0 and the read answered it with the FIRST PAGE.
    //
    // THE FIXTURES CARRY A DIRECTION ON PURPOSE. Two-segment fixtures would be
    // refused by the direction boundary above before ever reaching the digit
    // check, and this test would go on passing while measuring nothing — which
    // is precisely what a QA lane measured happening to the comms cursor tests
    // when this field was added: three mutants the base suite killed survived
    // at head because every fixture short-circuited. A test that passes for the
    // wrong reason is the thing this whole file is about.
    for (const cursor of [
      "channel-a:forward:",
      "channel-a:forward:0x2",
      "channel-a:forward: 3 ",
      "channel-a:forward:1e2",
      "channel-a:forward:-1",
      "7",
    ]) {
      expect(Option.isNone(decodeChannelCursor("channel-a", "forward", cursor))).toBe(true);
    }
  });

  it("accepts sequence zero when it is written as a digit", () => {
    // Distinct from the case above: the refusal is for text that is not a number,
    // not for the number zero, which is a legitimate sequence.
    expect(
      Option.getOrNull(decodeChannelCursor("channel-a", "forward", "channel-a:forward:0")),
    ).toBe(0);
  });
});
