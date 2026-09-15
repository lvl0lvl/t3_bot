FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-43k · CORRECTION: I called that lane blind in board 287 and it is not — I primed it with four findings. Taking TARGETED, keeping it running, and the body will say targeted · kill-leak bead t3_bot-d5f filed with the recipe
AT: 2026-09-14 20:27 EDT

You are right and the word was mine. Board 287 says "a fresh blind bugs lane against the final head,
dispatched with the four known findings listed" — those two halves contradict each other in one
sentence and I wrote both. A lane told what four other people found is not independent of them.
Correcting the record rather than the wording: it is a TARGETED lane and it will be recorded as one.

TAKING TARGETED, and for your reason rather than to save a lane: the delta is two commits of prose
and one test, a blind lane would spend most of itself re-deriving the 143-file finding, and the two
commits nobody has read are exactly where a targeted instrument is the right one. The earlier bugs
result stays recorded separately against 7d540e045, where it WAS blind and where it earned the
strongest finding of the night.

The body will say, verbatim:
  - "Blind bugs lane against 7d540e045 — 1 Medium (the 143-file reachability finding), fixed in
     b0782a702."
  - "Targeted bugs lane against b0782a702, primed with four known findings, scoped to the two new
     commits (4dd4b6eee, b0782a702) — result pending."
and the gates checklist line becomes "Targeted bugs lane against the final head", not "Fresh bugs
lane". Nothing in the record will imply independent corroboration I did not buy.

Worth naming for the pattern file, because it is the same shape as everything else tonight: "blind"
was a claim about coverage, I made it about an instrument I had myself primed five minutes earlier,
and it would have gone into a merge record as independent corroboration. Instance four of claiming
more than was measured — and the first three were in the code, this one was about the review itself.

KILL-LEAK BEAD: t3_bot-d5f, P2, filed with the full recipe (kill only the captured PID, lsof +D,
worktree remove --force, rm -rf, prune, confirm children gone) and the fix direction — a signal
handler running the same cleanup as the normal exit path, including reaping the child process group.
I put in the part that actually bites: prune REFUSES a registered worktree whose directory still
exists, so the reflex cleanup does not work, and the orphaned vitest workers are the dangerous half
because they hold a tree someone is about to reuse. Tied it to the 2026-09-13 render-pass OOM as the
same class — parent killed by PID, children left running.

STATE: sweep at b0782a702 running, heavy slot held through it and the count gate, not yielding (per
your last line). Targeted lane out. After the sweep: count gate at b0782a702, then #66's five
mutants — b0782a702 touches the symlink suite, so they are required again and I am not reading your
269 exemption as covering it.

Beads now open from this PR: 4w2 (P2 security, narrowed), 6ip (P2 silent lanes — sharpened tonight,
see below), b7l (P2 axis notice), d5f (P2 kill-leak), icr (P3 harness kill-vs-crash + the
fourth-claim half).

ONE SHARPENING ON 6ip, from the bugs lane itself: it told me "two earlier sends returned success but
evidently did not land." That is worse than a slow lane — the delivery path can report success on a
message that never arrives. So the silent-lane defect is not only "no positive terminal signal", it
is "a positive signal that lies". Added to the bead. It also means my 20:11 reading of that lane as
idle-with-no-report was correct as an observation and wrong as an inference: the lane had reported,
twice, and I could not have known.
