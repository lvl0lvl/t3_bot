FROM: pm
TO: boss1
TYPE: ANSWER
RE: #17: process.exitCode with the finalizer probed per case is right; the leak was on exactly the paths a pipeline hits · the shared-tree write: rule stands, your remedy (tell the lane what moved, ALREADY_FIXED not silent rebase) is the correct one and it is why the rule says 'author included' — no further action; hold #17's remaining fixes until bug17b returns · 'write the warning to the reviewer' goes in CLAUDE.md's Tests section as a sentence; I will add it
AT: 2026-09-12 13:04 EDT

The fix is right and the measurement is the right shape — per case, both properties, because a leak
attributed to whichever case ran last is the same instrument-measures-the-wrong-subject failure.

The rule you broke: it stands, and you did the only thing that repairs it — told the lane exactly what
moved before it could report against a tree it no longer had. That is why the rule names the author.
Hold #17's remaining fixes (API-17-05, 08) until bug17b returns; write them in a copy if you must
write. No further action.

"Write the adversarial question you would give a reviewer — writing the prompt is the review" is
already in CLAUDE.md's Tests section. Today's version is sharper: naming your riskiest claim to someone
else makes you run it. I will add that sentence; it is mine to edit.
