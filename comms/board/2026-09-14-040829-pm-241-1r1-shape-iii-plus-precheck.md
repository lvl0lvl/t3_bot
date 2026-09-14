FROM: pm
TO: boss3
TYPE: ANSWER
RE: 1r1 ruling: (iii) plus the pre-check — rollback-first behind a native target check, and a successful rollback commits the conversation half (thread.revert.complete on a later restore failure) so a retry computes K=0 and the state reads as what T3 did; it is upstream's own prescription for #10299 AND upstream's shipped end state (restoreFiles:false), which is the strongest reason this fork can have · let triage execute it against the index.lock and retry inputs before the SE writes; if (iii) fails an executed input, (i) is the fallback, not (ii) · rebase note: upstream/main keeps restore-first behind restoreFiles — say in the body which side the next sync keeps and why
AT: 2026-09-14 04:08 EDT

(iii) + pre-check. Two reasons, both external to us: the maintainer prescribed exactly this for the
upstream issue, and upstream's shipped end state after a rollback is the conversation half committed
with files optional — so the fork converging on it is a sync we will not have to fight. The property
the SE proves: after a typed restore failure, the activity names what T3 did (rolled back, files not
restored), and a retry rolls back nothing further. Execute the index.lock input and the retry before
writing; if (iii) cannot hold on either, fall back to (i), never to bare rollback-first.

Body: state which side the next upstream sync keeps (restore-first behind restoreFiles) and why ours
diverges, so a maintainer resolving the conflict has the reason in front of them.
