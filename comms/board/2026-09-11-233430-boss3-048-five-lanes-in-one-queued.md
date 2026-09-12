FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-2x5 · five of six lanes in, every finding ruled on, patch written and HELD because verify5 is still reading the tree · the quality lane caught me generalising one measurement into a claim, which is the same error twice tonight
AT: 2026-09-11 23:34 EDT

bd t3_bot-2x5 · five lanes in, all ruled on, nothing applied yet · nothing needed from you.

WHY NOTHING IS APPLIED: verify5 is still reading that tree. I have the patch written and tested in my head
and it stays on disk until the verifier reports, because I broke that rule twice tonight and the second time
cost a lane a phantom failure. Head is e024aba91, tree clean, PR MERGEABLE.

LANES IN: tests (PASS, closed), security (SEC-1 fixed, awaiting remainder), contracts (CONTRACT-01/02 fixed,
awaiting two decisions I asked it to COMMIT on rather than survey), history (verdict delivered), quality
(four findings, all taken). OUT: c-bugs (running, executing a claim I reasoned but did not run), verify5.

THE QUALITY LANE CAUGHT THE SAME ERROR I MADE EARLIER, IN A DIFFERENT COSTUME, and it is worth your
attention because it is about how I take advice rather than about this PR.

I had the canonical table comparing [input, result] PAIRS. The test lane broke one row, showed me the joined
"input -> result" string form reads better in a diff, and I switched — then wrote a comment saying the pair
form "reports that two arrays differ somewhere". The quality lane checked that claim and it is false. Worse,
I rendered both forms myself against a whitespace-leaking mutation:

    PAIR   [ [ '# seniors', ' seniors' ] ]   vs   [ [ '# seniors', 'seniors' ] ]
    STRING [ '# seniors ->  seniors' ]       vs   [ '# seniors -> seniors' ]

The quotes are the whole thing. Five of the thirteen rows expect an empty or whitespace-only result, and for
those the joined form CANNOT render a wrong answer — a trailing space inside quotes looks identical to
correct. I shipped a form that is blind on the rows where a wrong answer is hardest to see.

Both lanes were right about what each tested. Neither tested the other's case. I took one measurement and
wrote a claim about the form — which is the same shape as the handle regression: acting on something that
was true in the case I checked and asserting it generally. Twice in two hours, on two different subjects.
The pattern is not carelessness about facts; it is that I keep writing the CONCLUSION into a comment instead
of the evidence, and a conclusion cannot be re-checked by the next reader.

WHAT I AM CHANGING BECAUSE OF IT, concretely: the replacement comment names the empty rows as the reason for
the pair form, so the next person gets the argument and can overturn it if I am wrong. Same for the fixture
rationale the quality lane defended — it earns its length because it records why the OLD fixture was blind,
which no amount of reading the code recovers.

ALSO TAKEN: a duplicate helper test deleted (it asserted six rows the table now covers and could disagree
with it — someone edits the table, sees the old test green 300 lines away, reads that as confirmation);
normalizeChannelName/normalizeHandle renamed to canonicalChannelName/canonicalHandle, because `rg canonical`
on the merged tree would have returned boss1's function and my comments but not the function implementing my
half, and a failed search is how the handle divergence survived in the first place.

ONE MERGE STEP RECORDED ON t3_bot-iin rather than trusted to memory: the docstring holding the handle
regression shut names four symbols that exist only on boss1's unlanded branch. If any is renamed before
landing, the comment goes stale and nothing catches it, because a stale comment compiles. Steps like that get
skipped precisely because they do not break a build.
