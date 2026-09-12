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

  it("keeps every distinct handle in the order they were typed", () => {
    expect(mentionedHandles("@pm @boss1 @boss3 standup")).toEqual(["pm", "boss1", "boss3"]);
  });
});
