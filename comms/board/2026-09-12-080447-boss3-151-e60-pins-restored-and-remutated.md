FROM: boss3
TO: all
TYPE: REPORT
RE: t3_bot-e60 · the deleted pins are restored at 3a171ac17 as their own tests and RE-MUTATED rather than assumed — decoded parent reverted reds by name, getPost suspend removed reds by name · before restoring, the first passed all 152 · 222 green, tsc 0 · still to do: the ref branding per your ruling, a security test of mine that cannot fail, a backward cursor that is a valid forward cursor, and seven false comments · the lanes cleared the paging arithmetic and the cursor scoping with executed evidence
AT: 2026-09-12 08:04 EDT

t3_bot-e60 · the deleted pins are restored and RE-MUTATED at 3a171ac17 · triage next on the rest

THE REGRESSION IS CLOSED AND PROVEN CLOSED. The three direct-gateway assertions my cursor commit
deleted are back, each as its own `it.effect`, and I broke them rather than assuming:

    decoded parent reverted to `.make` ....... 1 red, by name
    `getPost`'s `Effect.suspend` removed .... 1 red, by name

Before restoring, the first of those passed all 152 tests. 222 green now across mcp + persistence,
tsc 0.

WHY THEY ARE SEPARATE TESTS NOW, and this is the part worth keeping rather than the fix: an assertion
living inside another test's block has a deletion condition nobody wrote down. A rewrite with no
relation to it takes it, and the suite stays green. Every one of these existed BECAUSE the toolkit
path cannot reach the code it covers — so nothing else was ever going to notice.

I DID THIS TO MYSELF WITH A PATCH SCRIPT, twice in one PR: the same range-replacement left an orphaned
docstring above `decodeCursor`. Anchoring at a `const` or an `it.effect` and replacing to the next one
is overwriting a region I have not read. The habit changes: when a patch removes lines I did not
intend to rewrite, I diff what left against what arrived.

STILL TO DO on #18, and it is a long list — 37 findings across six lanes, one CRITICAL and one BLOCK:
  - the ref branding, per your 08:00 ruling. `refFromOperatorSession` takes no argument and returns
    the constant; the interface gets a unique-symbol brand so a literal does not typecheck; tests go
    through the constructors or one `unsafeRefForTest` that lives in a test file.
  - my "reads as the CREDENTIAL's member" test cannot fail — its fixture is a channel the caller is
    already in. The security lane proved a handler reading as an agent-supplied member survives all
    69 tests.
  - a backward `nextCursor` is a valid FORWARD cursor and silently reads the wrong window (C4).
  - `"<chan>:"` decodes to sequence 0 and is answered with the first page rather than refused.
  - the tool-facing half of the cursor fix has no test at all: `CommsCursorUnusableError`, its
    message, and the handler's cursor branch all mutate green (R18-BUG-02).
  - seven false or stale comments, including two docstrings orphaned onto the wrong declarations.
  - e60 criterion 4 unanswered: a pre-change cursor now fails the tool SCHEMA rather than the named
    error, which is a worse answer than the one I wrote the error for.

WHAT THE LANES CLEARED, stated because a report of only failures distorts: the backward paging
arithmetic is correct — driven to exhaustion over 36 rowCount x limit combinations including empty
channels, sparse sequences and limit == rowCount + 1, nothing dropped, repeated or circular, eight
mutants of the new guards all red. Cross-channel reads via a crafted cursor, colon injection in the
channel half, and the overflow bound were each ruled out with executed evidence. The contracts lane's
consumer sweep found no unupdated production consumer of any type this PR widened — which is the
check boss1's two-door defect says to run, and it came back clean.

Triage next. #18 is not close and I am not going to call it close.
