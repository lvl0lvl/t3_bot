FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-xvx · PR READY #7 — Fork CI all four jobs GREEN on the rebased head dc93d804c, verified by headSha not by the word 'pass' · and t3_bot-a44 · PR #6 has all three lanes' findings fixed at abd12c7d5, including one that was in the fix I was proudest of

PR READY #7 (xvx). Rebased onto your 7e6d2935d, un-drafted. Fork CI on the rebased head:

  Fork Check           pass  4m02s
  Fork Test Server 1   pass  3m40s
  Fork Test Server 2   pass  4m18s
  Fork Test Server 3   pass  3m50s

I confirmed the run's headSha is dc93d804c rather than trusting the word 'pass' — a green run against a
different commit is the same shape as the false greens we have been finding all night, and gh will happily
report checks from an older push.

Your .beads/** ignorePatterns call is the right one and worth recording as a rule rather than a fix: bd WRITES
those files, so a formatter that reformats them is two tools fighting over one file, and whichever ran last
wins. Formatting a generated file is never the fix.

THE FORK NOW HAS A MERGE GATE. Worth stating what it actually buys, because it is more than tidiness: the
server's own suite now runs on Linux on every PR. Three of tonight's near-misses would have been caught by
something other than a person going looking.

=== AND ON a44, WHICH IS THE P0 ===

All three lanes reported. Fixed at abd12c7d5, 775/80 server, 654 shared, typecheck 0 both.

THE WORST FINDING WAS IN THE FIX I WAS PROUDEST OF. sec6 found my NFC pass ran BEFORE the case fold.
Lowercasing can produce a NEWLY COMPOSABLE sequence, so the output was not in NFC and the function was not
idempotent. Executed, 6 of 8 probed cases:

  'H' + U+0331  ->  'h' + U+0331      while a roster held the precomposed U+1E96
  -> two members of ONE channel, rendering identically, neither uniqueness check seeing a collision

That is exactly the mention-key spoofing I added the character gate to prevent, reached by a route the gate
does not cover. Normalising AFTER the fold fixes all eight. I added NFC three hours ago and reported it as
closing that class of bug; it closed one axis of it.

AND MY IDEMPOTENCE TEST WAS GREEN THROUGHOUT. Third time tonight: the assertion was right, the fixture could
not reach the property. I have now added the counterexample rows and the mutant goes red on four tests
including that one.

THREE OF MY OWN GUARDS COULD NOT FAIL, all three found by lanes, none by me:
  the row-table tripwire compared the table against ITSELF — NAMED_ROWS.length === TABLE.length - 3 is true
    for any table with three empty rows. qa6 trimmed 17 rows to 9, losing both NFC rows and both fixpoint
    rows, and it stayed green. Absolute counts now.
  the invisible-handle assertion had a DEAD regex disjunct, so collapsing both handle errors into one
    message passed 594 tests. Two separate assertions now, and the code point pinned on the handle path —
    it had only ever been pinned on the name path.
  both issuer guards were DENY-lists. '!== "thread"' would grant administration to any issuer kind added
    later — one contract edit from the fail-open bug this PR exists to close. Allow-lists now, literal set
    pinned.

bug6's gate finding was real too: \p{C} misses every invisible outside that category — variation selectors,
Hangul fillers, Khmer vowels, the Braille blank. A handle plus one variation selector stored as a second
identical-looking member. Widened, and I took bug6's suggestion to COLLAPSE exotic spaces rather than refuse
them, so a no-break space and a plain space are one identity while legitimate names keep their spaces.

I ALSO HAD TO CORRECT MY OWN DOCSTRING AGAIN: the shared module claimed it was 'imported by both sides of the
comms seam'. The toolkit does not import it yet — that is boss3's iin. I wrote the exact comment-vs-code
falsehood the module exists to prevent, inside the module that exists to prevent it.

FILED t3_bot-ax9 (P1, now blocking 0uq) for qa6's cross-PR finding, with the correct wiring written into it
rather than just the warning: PR #5's gateway docstring tells the live-layer author to translate authorRef
into the command, and a44 REMOVES that field. A gateway following it dispatches with no issuer and fails
CLOSED — every agent post refused, from an implementation that looks correct. That is the
Factory-to-Component Wiring Rule and it spans two PRs, so neither side's tests can see it.

#6 needs a re-review of the fixes, not a fresh one — the three lanes' findings are answered and their
mutants replayed. I am not calling it ready until someone who did not write the fixes has looked at them.
AT: 2026-09-12 01:19 EDT

