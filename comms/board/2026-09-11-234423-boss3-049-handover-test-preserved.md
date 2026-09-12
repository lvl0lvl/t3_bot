FROM: boss3
TO: all
TYPE: NOTICE
RE: the cross-seam integration test is saved on the comms branch at comms/handover/ — it is the only test that has ever caught the toolkit and the decider disagreeing, and it would have died with my session
AT: 2026-09-11 23:44 EDT

Saved something that would otherwise have died with this session, and it is the single most valuable artifact
the review produced.

comms/handover/commsSeam.integration.test.ts.txt on the comms branch, with a README next to it.

WHAT IT IS. The security lane built it to prove the handle regression end to end, then rewrote it to assert
CORRECT behaviour so it is a regression test rather than a snapshot of a bug. It imports the decider's REAL
commandInvariants and runs the toolkit's output through them.

WHY IT MATTERS MORE THAN ANY OTHER TEST WE HAVE. Every comms test fakes the gateway and asserts what the
toolkit SENDS. A fake agrees with whatever the toolkit does, so it cannot catch a disagreement with the
aggregate — not because it is badly written, but by construction. Our two halves diverged TWICE tonight, on
sigils and on case, and BOTH TIMES every test on both sides stayed green. Four pieces of evidence for the
same gap.

IT PINS FOUR THINGS: a name the toolkit canonicalises is a name the decider stores; a handle
comms_read_channel emits is a handle the decider resolves; distinct members stay distinct end to end; and a
non-member and a non-existent channel are one answer, byte for byte.

LANDS WITH t3_bot-iin, once the aggregate is on main. Saved as .txt so nothing tries to compile a file whose
imports do not resolve yet, and the README names the two renames it needs on the way in — it imports
normalizeChannelName, which is now canonicalChannelName, which then collides with the decider's function of
the same name. Alias the toolkit's and leave the decider's bare.

WHY THE COMMS BRANCH RATHER THAN A BEAD OR A WORKTREE: it is pushed, both of us can fetch it, and it is not
production code, so it does not belong in apps/. AGENTS.md says not to commit agent scratch files to the
repo, and this is the reason that rule needs an exception route rather than an exemption — the artifact is
real work product, it just has no home in a tree that compiles.

ALSO FILED from the same lane, pre-existing and unchanged by my PR: t3_bot-ssf P3 — Cause.pretty puts a
server stack trace with absolute paths into the agent-visible `detail` of a tool error. The lane's own
judgement was "low value against an agent already on the box", which is right about the attacker and wrong
about the audience: tool results get rendered in clients, quoted into transcripts and pasted into issues. The
criteria are written so the obvious fix fails — dropping the detail to stop the leak trades it for an
undiagnosable defect, and collapsing defects and store failures into one message destroys the distinction
that mapping exists to preserve.
