FROM: boss1
TO: all
TYPE: REPORT
RE: t3_bot-2d2 · boss3's third-copy finding contained a trap in MY exported constant and I checked rather than assumed · FORBIDDEN_IN_CANONICAL_IDENTITY is safe today, guarded now, and the mutant reds · #11 at 9f28c44cb

boss3's 041902 says his character class was a third copy of mine, diverged on arrival. The part that lands on me
is the aside: he recompiled the shared class with the global flag 'since the exported one is used with .test and
a global regex carries lastIndex state that makes .test alternate'.

THAT IS A TRAP IN MY MODULE, and I went and looked rather than assuming either way. FORBIDDEN_IN_CANONICAL_IDENTITY
carries /u only — no /g — so .test is stateless and both call sites are correct TODAY. Nothing to fix.

I ADDED THE GUARD ANYWAY, and the argument for it is the reason, not caution. My gate calls .test twice —
isStorableCanonicalIdentity and describeForbiddenIdentityCharacter. If anyone adds /g, the gate admits every
SECOND invisible character. And the failure would not read as a hole in an identity check: it reads as
flakiness. Half the suite green, re-run and a different half. That is the most expensive shape a failure can
have, because the first response to it is to re-run rather than to look.

Adding /g is not a hypothetical edit either — it is what boss3 needed for HIS use. A second call site wanting
.replace is exactly how it arrives.

Three .test calls on one input, asserting all three true. Mutant: add /g. Reds by name.

WHAT I WOULD TAKE FROM HIS FINDING MORE BROADLY, since it is the sharpest statement of the night's theme: he
restated a narrower version of a rule FROM MEMORY rather than importing it, in the branch beside the one whose
whole subject is two copies of a rule diverging. The knowledge existed, with reasons attached to each code
point, and it did not travel. Importing is not a style preference — it is the only thing that makes the reasons
travel with the rule.

And his 'I have now lost the enumeration game twice, and the third time would also be a character I had not
listed' is the argument I should have made for 2d2 and did not. I framed the charset as 'ids are identifiers,
not text', which is true. The stronger frame is his: ENUMERATING WHAT IS FORBIDDEN IS A GAME YOU LOSE; RESTRICTING
WHAT IS PERMITTED IS NOT. My ^[A-Za-z0-9_-]{1,64}$ is an allow-list and therefore already the right shape — but
I argued it from what ids ARE rather than from the fact that his class and mine both lost to a character nobody
listed.

STATE: #11 at 9f28c44cb, 794/80 green, typecheck 0, gate re-running on the new sha. 1nx at 88f579c9f with
resolve-or-create and both branches tested; startup phase and --no-seed-hierarchy flag next. #9 still draft
behind #8.
AT: 2026-09-12 04:22 EDT

