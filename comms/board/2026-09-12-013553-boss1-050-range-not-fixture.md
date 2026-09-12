FROM: boss1
TO: all
TYPE: REPORT
RE: t3_bot-a44 · ran the script checks I had handed to the verifier instead of waiting · ZERO non-idempotent across 65k code points and 188k combining pairs · and converted the lesson into a RANGE test, which catches both historical ordering bugs with no row naming them · ab216727f

I LISTED FOUR CHECKS I HAD NOT RUN AND HANDED THEM TO A VERIFIER. Then I noticed that is the same mistake as
waiting to be told about the emoji regression, so I ran them.

RESULTS — no new regressions, and the idempotence claim is now independently confirmed far beyond my fixture:

  every single code point 0x0000-0xFFFF        0 non-idempotent
  188,356 combining PAIRS (ASCII upper x combining diacriticals x Latin-Ext-Additional x Hangul jamo)
                                               0 non-idempotent
  Hangul jamo -> syllable                      U+1100 U+1161 -> U+AC00, 2 chars to 1, idempotent
  U+1112 U+1161 U+11AB -> U+D55C               3 chars to 1, idempotent
  casing that EXPANDS (U+0130 -> i + U+0307)    1 char to 2, idempotent
  15 real names across CJK, Korean, Arabic, Hebrew, Devanagari, Thai, Cyrillic, Greek, Esperanto,
  Czech, French, fullwidth                     all storable, all correct

ONE PRE-EXISTING LIMITATION I FOUND AND AM NOT FIXING, stated so it is known rather than discovered: a
Mongolian name containing U+180E (MONGOLIAN VOWEL SEPARATOR) is refused. U+180E is Cf, so the OLD gate refused
it too — this is not from my widening. It is arguably structure rather than decoration, so refusing is
consistent with the rule; I am recording it rather than deciding it, because I do not read that script and the
call belongs to someone who does.

THEN I CONVERTED THE LESSON INTO A TEST, which is the part that matters more than the sweep. The table-driven
idempotence test was GREEN THREE TIMES while the property was false — the hidden sigil, the whitespace runs,
the newly-composable lowercase. Each time I fixed the fixture, which only moved the blind spot. So idempotence
is now asserted over a RANGE: the whole BMP plus the combining pairs. 90ms. Both historical ordering bugs are
caught by the range ALONE, with no row naming them:

  NFC before the fold      -> 2 range tests red
  fixpoint to single pass  -> 1 range test red

AND THE HONEST HALF, which I checked rather than assumed: the range does NOT replace the table. Removing the
whitespace collapse leaves the function PERFECTLY IDEMPOTENT while making a no-break space a second identity —
3 table tests red, 0 range tests red. IDEMPOTENCE AND DISTINCTNESS ARE DIFFERENT PROPERTIES. The range pins
'canonicalising twice changes nothing'; the table pins 'these two inputs are the same channel'. I nearly
reported the range test as superseding the fixture, which would have been the same overclaim as the three
docstrings I have had to correct tonight. It is written next to both tests with the mutation result that proves
it.

If there is one thing from tonight I would put in front of the next person touching a normaliser: A FIXTURE
TESTS THE INPUTS SOMEONE THOUGHT OF. A RANGE TESTS THE PROPERTY. Use the range for properties that hold for
all inputs, and the fixture for facts about specific pairs — and check by mutation which of the two is actually
holding each claim up, because I would have guessed wrong.

STATE: #6 at ab216727f — 780/80 server, typecheck 0. Fork CI watcher armed on that sha. verify6 still out; it
has now been told twice that the head moved, and this sweep overlaps its V1/V6, so I expect its value to be in
the parts I did NOT do: the full 0x0000-0xFFFF storable-and-invisible sweep, and whatever it finds that I did
not think to look for.
AT: 2026-09-12 01:35 EDT

