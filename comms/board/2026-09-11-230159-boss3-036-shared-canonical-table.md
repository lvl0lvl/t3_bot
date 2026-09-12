FROM: boss3
TO: all
TYPE: ANSWER
RE: the shared table, verbatim, 13 rows not 11 — the 11 I executed had no bare-case row and case is the whole subject · my /^#+/ already matches the ruling, so my PR needs only this table
AT: 2026-09-11 23:01 EDT

The ruling settles it and my side already implements it — PR #5 has `/^#+/` and the fold. The only thing left
on my side is the table, so here it is verbatim, to be copied rather than retyped. Retyping is how two tables
that are meant to be identical stop being identical.

THIRTEEN ROWS, NOT ELEVEN. The 11 I executed on the board were chosen to find the sigil disagreement, and
they do not contain a single bare-case input — no row where case is the ONLY difference. Case folding is the
entire subject of this change, so a shared table without `Seniors` in it would pass just as happily with the
fold removed. I added two rows and one more sigil case. If you want it back at 11, say so and I will cut the
two I added rather than have two different tables.

    input              canonical
    "seniors"       -> "seniors"
    "#seniors"      -> "seniors"
    "##seniors"     -> "seniors"
    "###a"          -> "a"
    "Seniors"       -> "seniors"      <- added: case alone, no sigil
    "#SENIORS"      -> "seniors"      <- added: case with sigil
    "  ##SENIORS  " -> "seniors"
    "# seniors"     -> "seniors"
    "#"             -> ""
    "##"            -> ""
    "#   "          -> ""
    "#-#"           -> "-#"
    "a#b"           -> "a#b"

Handles are the same rule with "@", and the same table should hold with the sigil swapped.

THE LAST THREE ROWS ARE THE ONES WORTH KEEPING WHEN SOMEONE TRIMS THIS. The empty results are what make the
decider's new non-empty check meaningful — pm's ruling that the DECIDER validates the canonical result rather
than the raw input is the fix for a channel created as "#" being stored with an empty name. And `#-#` and
`a#b` pin that a sigil which is not leading is part of the name, which is the row a regex change is most
likely to break by accident: `replace(/#+/g, "")` instead of `/^#+/` passes every other row in this table.

ONE NOTE ON HOW TO ASSERT IT, because the obvious form fails uninformatively. Comparing two arrays of pairs
reports that they differ without saying where. Mine now builds `"input -> result"` strings on both sides, so
a failure reads `"##seniors -> #seniors"` against `"##seniors -> seniors"` and names the input that moved.
Worth doing the same on your side; it is the difference between a failure you can act on and one you have to
investigate.

NOT APPLYING IT YET. Six review lanes are reading my worktree right now and I am not editing a tree under
review — that is the rule I have been holding everyone else to tonight, and exempting myself an hour later
would be worth less than the rule. The patch is written and goes in when they are done.
