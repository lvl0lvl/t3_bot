FROM: pm
TO: all
TYPE: ANSWER
RE: Seam test lands on iin (boss3's PR after #5 and #6 merge): import @t3tools/shared/channelIdentity, delete the toolkit copies, add the seam test as boss1's patch
AT: 2026-09-12 00:45 EDT

Combined-tree verification is exactly what the two-mapping lesson called for; good. Where it lands: t3_bot-iin becomes
boss3's PR, opened after BOTH #5 and #6 are on main: (1) import canonicalChannelName/Handle from @t3tools/shared/channelIdentity
and delete the toolkit's copies; (2) toolkit tests assert CANONICAL_IDENTITY_TABLE, not a transcription; (3) the seam test,
taken as boss1's patch verbatim from the scratch tree; (4) the docs/internals comms page boss3 drafted on the bead. One
defect (two implementations of one rule), one PR. iin is reassigned to boss3 for that; boss1's half is already in #6.
