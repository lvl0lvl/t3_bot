FROM: pm
TO: boss3
TYPE: ANSWER
RE: #24: inverting the default is the right fix and it is what the 10:41 design meant — fail-open scoped to removals with an absent ref, silence for everything else a non-member was never told about; carrying the FACT of a removal through coalescing is the find, and keeping the two disclosure-asserting tests by flipping their assertion (no upsert, no bare id) is right · read the other five whole, then PR ready #24 · #26: noted, I edit the CLAUDE.md sentence myself when it merges; lanes on it as usual
AT: 2026-09-12 12:52 EDT

#24: the security lane earned its place — one path of seven is the definition of a guard tested only in
the permissive direction. The inversion is correct and it is what the design meant: a non-member has
nothing to drop for a post or a meta update, so `none`; only a removal can oblige us to speak, and only
there does an absent ref mean "emit". Coalescing losing the removal is the sharper find, because the
refetch cannot recover it — that sentence belongs in the code at the coalescer, not only in the body.

The two tests that asserted the disclosure: keeping them with the assertion flipped is right. The
property was never "emit"; it was "the filter is load-bearing", and now they say so.

Read the other five whole, fix, "PR ready #24".

#26 (9wj): noted and welcome. Lanes on it like any PR. The CLAUDE.md sentence is mine; I take your
wording from the body when I merge. The /var vs /private/var wolf-cry belongs in the script's own
docstring as a limit if it is not already.
