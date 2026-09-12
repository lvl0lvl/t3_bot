import { describe, expect, it } from "@effect/vitest";

import { mentionedHandles } from "./channelMentions.ts";

describe("mentionedHandles", () => {
  it("does not read an email address as a mention", () => {
    // The "@" here is preceded by a word character, so it starts no mention. It
    // matters more than it looks: an unresolvable mention makes the decider
    // refuse the WHOLE post, so collecting "example.com" here does not add a
    // stray mention, it loses the operator's message with nothing visibly wrong
    // in what they typed.
    expect(mentionedHandles("email me at walt@example.com")).toEqual([]);
  });

  it("reads a mention at the very start of the body", () => {
    // A body that opens with a mention has no preceding whitespace, which is
    // the case a lookbehind-only boundary silently drops — and "@boss1 ..." is
    // how most posts to one person begin.
    expect(mentionedHandles("@boss1 can you look at this")).toEqual(["boss1"]);
  });

  it("ends a handle at sentence punctuation rather than swallowing it", () => {
    // "@walt." at the end of a sentence is a mention of walt. Keeping the stop
    // sends "walt." — a handle nobody has — and the post is refused.
    expect(mentionedHandles("over to @walt.")).toEqual(["walt"]);
    expect(mentionedHandles("@walt, @boss3: see above")).toEqual(["walt", "boss3"]);
  });

  it("folds two spellings of one handle into one mention", () => {
    // "@Boss1" and "@boss1" are one member. Sending both would wake them twice
    // for one post, and the decider dedupes for exactly that reason — doing it
    // here as well is what makes the wire carry keys rather than typed text.
    expect(mentionedHandles("@Boss1 and @boss1 are the same person")).toEqual(["boss1"]);
  });

  it("drops a run of at-signs instead of sending an empty handle", () => {
    // "@@@" canonicalises to the empty string. Sending it would have the decider
    // refuse the post for a handle that is only sigils, which is a bad trade for
    // prose that happens to contain at-signs.
    expect(mentionedHandles("what @@@ even is this")).toEqual([]);
  });

  it("reads a mention inside brackets", () => {
    // Parenthesising a mention is ordinary prose — "(@walt has context)" — and
    // the opening bracket is not whitespace, so a whitespace-only boundary drops
    // it.
    expect(mentionedHandles("worth a look (@walt has context)")).toEqual(["walt"]);
  });

  it("reads a mention wrapped in emphasis, quotes, or backticks", () => {
    // EVERY ONE OF THESE RETURNED [] BEFORE. The opener set and the terminator
    // set were written separately, so `*`, `"` and a backtick could END a handle
    // but not BEGIN a mention — the post was accepted, the sidebar reordered,
    // and the member was never woken.
    //
    // Silent is what makes it serious. `requireChannelMentionsResolve` refuses a
    // post whose mention resolves to nobody so that a post cannot look sent
    // while waking nobody; a mention dropped here never reaches that guard, so
    // nothing reports the loss — not the server, which never saw the mention,
    // and not the client, which succeeded.
    expect(mentionedHandles("**@boss1** urgent")).toEqual(["boss1"]);
    expect(mentionedHandles('she said "@boss1" earlier')).toEqual(["boss1"]);
    expect(mentionedHandles("`@boss1` please")).toEqual(["boss1"]);
    expect(mentionedHandles("<@boss1>")).toEqual(["boss1"]);
    expect(mentionedHandles("@walt/@boss3 either of you")).toEqual(["walt", "boss3"]);
  });

  it("ends a handle at NON-ASCII punctuation too", () => {
    // EACH OF THESE OVER-COLLECTED while the boundary was an ASCII range list,
    // and each is reachable by typing rather than by trying: macOS substitutes
    // an em-dash for `--` as you type, and this repo's own copy uses curly
    // quotes and ellipses.
    //
    // The failure mode is the loud one rather than the silent one — an
    // unresolvable handle makes the decider refuse the WHOLE post — but it is
    // the same loss of the operator's message.
    expect(mentionedHandles("over to @boss1\u2014he has context")).toEqual(["boss1"]);
    expect(mentionedHandles("ping @boss1\u2026 later")).toEqual(["boss1"]);
    expect(mentionedHandles("@boss1\u2013b next")).toEqual(["boss1"]);
    expect(mentionedHandles("she said \u201c@boss1\u201d earlier")).toEqual(["boss1"]);
    expect(mentionedHandles("\u300c@boss1\u300d in japanese brackets")).toEqual(["boss1"]);
  });

  it("reads a handle written in a non-latin script", () => {
    // The boundary must not be wider than the roster it parses against. Letters
    // are letters in every script, and a class that excluded "anything not
    // ASCII" would drop this silently — the same failure as the emphasis case,
    // in new clothes.
    expect(mentionedHandles("\u30dc\u30b91 is on it")).toEqual([]);
    expect(mentionedHandles("@\u30dc\u30b91 is on it")).toEqual(["\u30dc\u30b91"]);
  });

  it("keeps a hyphen inside a handle, and so cannot open a mention after one", () => {
    // The one trade the single set forces, stated as a test rather than left to
    // be discovered. `-` is a handle character on BOTH sides: `@boss-1` is one
    // handle, which a roster may well need, and the cost is that `-@walt` with
    // no space is not a mention. A character cannot be both a handle character
    // and a boundary.
    expect(mentionedHandles("@boss-1 owns it")).toEqual(["boss-1"]);
    expect(mentionedHandles("-@walt unspaced bullet")).toEqual([]);
  });

  it("reads a handle that is an emoji", () => {
    // `channelIdentity` supports emoji handles deliberately — refusing them was
    // a regression it records — so the parser must not be narrower than the
    // roster it parses against. A letters-and-digits handle class would drop
    // this one silently, which is the same failure as the emphasis case.
    expect(mentionedHandles("ping @\u{1F525} about the build")).toEqual(["\u{1F525}"]);
  });

  it("keeps every distinct handle in the order they were typed", () => {
    expect(mentionedHandles("@pm @boss1 @boss3 standup")).toEqual(["pm", "boss1", "boss3"]);
  });
});
