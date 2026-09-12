FROM: boss1
TO: all
TYPE: REPORT
RE: a44 · all three lanes' findings fixed at 559a49a35 · the HIGH was caused BY my fixpoint fix, so I deleted the second canonicaliser instead of re-syncing it a fourth time · boss3: import @t3tools/shared/channelIdentity and delete yours

THE HIGH FINDING WAS MINE, CAUSED BY MY OWN FIX. sec-canon and bug-canon found it independently: my fixpoint
change widened the decider/toolkit divergence from 3 rows to 7. Executed, their table:

  'Seniors'        decider='seniors'  toolkit='Seniors'      pre-existing (case)
  '# #seniors'     decider='seniors'  toolkit='#seniors'     NEW, caused by my fixpoint
  '#  #  #seniors' decider='seniors'  toolkit='#  #seniors'  NEW
  '## ##SENIORS'   decider='seniors'  toolkit='##SENIORS'    NEW
  '# #'            decider=''         toolkit='#'            NEW — and worse than a miss: non-empty, so
                                                             the toolkit's own empty guard passes it to a
                                                             lookup that cannot match

Every DIVERGE row is a channel the toolkit cannot reach, reported as the same error a non-member gets. I made
the decider more correct and the SEAM less correct, and I would not have predicted that from my change.

I DID NOT RE-SYNC THEM. Three divergences in one evening — one sigil vs a run, case, NFC — and every time both
sides' tests were green, because A COPY AGREES WITH ITSELF. Re-syncing a fourth time fixes the symptom. The
second copy IS the defect. So the rule now lives in ONE place:

  packages/shared/src/channelIdentity.ts   canonicalChannelName, canonicalChannelHandle,
                                           isStorableCanonicalIdentity, the forbidden-character rule

commandInvariants imports it and re-exports the two names so nothing else moved. Precedent is
normalizeProjectPathForComparison, which commandInvariants already imported from @t3tools/shared/path — so
this is where the codebase already puts this kind of rule, not a new idea.

BOSS3 — THIS IS THE 'SAY THE WORD' YOU OFFERED AT 232246. Import canonicalChannelName and
canonicalChannelHandle from '@t3tools/shared/channelIdentity' and DELETE both of yours. Your #5 merges first
per pm's 002231, so the module arrives after you — the import is a follow-up on iin, not a change to #5. I
also exported the row table as CANONICAL_IDENTITY_TABLE from canonicalChannelName.test.ts so your tests assert
the same rows rather than a transcription. sec-canon's specific note: your handlers.test.ts row list omits
every case row and every hidden-sigil row, which is why 56/56 was green over all seven divergences.

TWO MEDIUMS FROM sec-canon, BOTH REAL, BOTH FIXED. 'Non-empty after trim' was not a real emptiness check:
String.trim removes 25 code points and NO control or format character. So a handle of one zero-width space was
storable, and '\u200Bboss1' was a distinct key that RENDERS as boss1 — an invisible twin in the member list
whose posts carry authorHandle rendering as boss1. Same gate admitted ANSI: a name of '#ESC[2JESC[1;1Hseniors'
stored fine and is echoed to agent and CLI output, which makes a stored name a terminal write.

Fixed with one predicate rejecting \p{C} plus the separators plus U+034F, probed over 14 cases first: it
rejects every trigger they reported and allows 'café', 'my channel', 'project-x.1'. The error names the code
point so an operator can act on it. NOT an allowlist — sec-canon suggested /^[a-z0-9][a-z0-9._-]*$/, which
would also refuse 'café', and I had just added NFC specifically so accented names work. If the PM wants the
stricter domain that is a ruling, not a line edit; I have implemented the version that closes the
vulnerability without narrowing the naming domain.

TWO MEDIUMS FROM bug-canon, BOTH REAL, BOTH FIXED.

ARCHIVED MEANT ALMOST NOTHING — his table, executed: post refused, but member.add ACCEPTED, member.remove
ACCEPTED, re-archive ACCEPTED. So a retired channel's roster still moved, and re-archiving OVERWROTE
archivedAt, destroying the answer to 'when was this retired' on an idempotent-looking retry. My comment said
'readable and no longer postable' and read broader than the code, which is the same comment-vs-code gap I have
been fixing all night. Now: membership refused on archived, both archive transitions refused on the wrong
state. The RENAME stays allowed and the docstring says why — channels have no delete, so renaming is the only
way to free a name the UNIQUE index still holds. He was right that it was correct-but-accidental; it is now
correct-and-stated.

FOLDING CREATED DUPLICATE MENTIONS. mentions ['@Boss1','boss1','@@BOSS1'] against member boss1 landed as
['boss1','boss1','boss1'] in the PERSISTED event — one member woken three times for one post. Before folding,
two of the three did not resolve and the post was refused, so my fix turned a refusal into a triplicate.
Deduped where the event is built, because the event is what replays.

qa-canon F-3 AND F-4, both fixed and both worth naming: two loops filtered the table and had no tripwire, so
trimming rows would empty the filter, run no loop body, and pass GREEN having retired the only coverage the
empty-canonical refusals have. One hoisted split with one count each now drives every loop. I replayed F-3 —
trimmed the three empty rows — and the tripwire fires naming what it protects.

STATE: a44 at 559a49a35. server orchestration+persistence+mcp 774/80, shared 654/55, contracts 387/23,
typecheck 0 on all three. #4 at 28a97cedc, 639/67.

ON pm's 002231 ORDER: agreed, and the reachability argument is the right one — nothing can reach a channel
lookup on main until 0uq registers the toolkit. Recording the one thing that makes it safe: the shared
canonicaliser lands with a44, so the FIRST change that makes the seam reachable arrives on a main where there
is only one implementation to agree with.
AT: 2026-09-12 00:23 EDT

