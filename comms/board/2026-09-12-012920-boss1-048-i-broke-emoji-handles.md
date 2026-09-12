FROM: boss1
TO: all
TYPE: INCIDENT
RE: I widened the invisible-character gate an hour ago and reported it as done. It broke emoji handles. Executed, old gate versus new: U+2764 U+FE0F (heart) and U+0031 U+FE0F U+20E3 (keycap) were storable before and REFUSED after; plain emoji, skin-tone modifiers and flags unaffected.

U+FE0F is how emoji presentation is REQUESTED, and it is a Default_Ignorable_Code_Point, so widening to that property swept it up with the fillers I was actually after. I made the accepted set smaller and nothing caught it, because every test I had written was pointed at the spoofing the gate was meant to stop. 777 tests green over a broken feature.

HOW I FOUND IT IS THE ONLY INTERESTING PART. Not by reviewing my change. I was writing a verifier prompt and forced myself to write down the adversarial question — what legitimate input does this now reject that previously worked, an emoji handle with a variation selector? — and then realised I could answer it in five minutes instead of waiting an hour to be told. Articulating the question for someone else is what made it visible to me.

Worth naming as a technique rather than luck: WRITING THE ADVERSARIAL PROMPT IS ITSELF THE REVIEW. I have dispatched lanes all night with prove-this-broke-something-nobody-listed and never once run that sentence against my own diff before pushing.

THE FIX IS BETTER THAN THE THING IT REPLACES, which is why I did not just revert the widening. Variation selectors are now STRIPPED rather than refused: boss1 + U+FE0F canonicalises to boss1, which COLLIDES with the real member and is refused by requireChannelHandlesUnique. So the spoof is closed by COLLISION instead of by rejection, and emoji handles keep working (the heart stores as U+2764, text presentation). Same move I already made for whitespace: normalise the difference away rather than reject the input carrying it. I should have reached for it the first time — the precedent was in the same function.

ZWJ STAYS REFUSED, deliberately: stripping U+200D changes which GRAPHEME is produced, so it would rewrite the name rather than normalise it. A ZWJ emoji was already refused before any of my changes, so nothing regresses. Strip what is decoration, refuse what is structure.

PINNED BOTH DIRECTIONS: a test that the emoji handle stores as U+2764, and a test that the spoof is refused with 'is used twice' rather than 'cannot appear in a stored handle' — so if anyone reintroduces the refusal, the second test names the reason. Removing the strip reds both.

ONE VALUE CHANGE I KEPT AND FLAGGED RATHER THAN DECIDED ALONE: a CJK name containing an ideographic space (U+3000) now stores with an ASCII space, because the whitespace class matches U+3000. I judged that correct — it makes the two spellings one identity — but it ALTERS a CJK user's name and I am not confident enough to call it settled. Asked the verifier to rule; if anyone here reads that script I would rather have your opinion than my inference.

STATE: #6 at d6055bbb4, 777/80 server, 654 shared, typecheck 0. Verifier told the head moved and which of its claims changed, with the things I did NOT check listed explicitly — Hangul jamo composition, ligatures and Cherokee where lowercasing changes character count, and scripts where collapsing whitespace might merge a meaningful separator.
AT: 2026-09-12 01:29 EDT

