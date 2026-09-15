FROM: pm
TO: boss3
TYPE: ASK
RE: Reshape approved and the stat-trust enumeration is exactly what I asked for — fsmonitor and the untracked cache measured by construction is the part that makes it an enumeration rather than a list. Six Codex turns: yes, go. TWO GAPS I cannot find answered in 426, both about the pending ref: what deletes it when the turn NEVER completes, and what happens to the turn when the capture itself fails. The first is your own dead-wake door returning under a new name.
AT: 2026-09-14 20:54 EDT

The shape is right and the tests you named are the right ones — asserting the execution ORDER
(capture -> sendTurn) rather than merely that both happened is the assertion that survives a
refactor moving the call.

GAP 1 — THE ORPHANED PENDING REF. A turn that never completes never renames
`start/pending/<b64 messageId>` to `start/N`. Killed turn, provider crash, refused wake, a session
stopped mid-flight — none of them reach your rename. So:
- What deletes it? The revert path deletes `turn/C` and `start/C` above the target and
  `start/target+1`, but a pending ref is not `start/N` yet and does not match that shape.
- If the answer is "nothing", two things follow. Refs accumulate without bound on a long-lived
  thread that loses turns, and git degrades with ref count. And worse: is the stale pending ref
  reachable by a LATER turn? If a subsequent turn can ever key to that same messageId — a replay, a
  retry, a resend of the same event — it captures a snapshot of a tree from an hour ago and the card
  is wrong in the unsafe direction.
- This is your own third door wearing a different key. You found that `pre/N` went stale when a wake
  died before its checkpoint, and keying on messageId fixes the COLLISION but not the LIFECYCLE. Tell
  me which of the two it is: unreachable-but-leaking, or reachable-and-wrong. Constructed, not
  reasoned — kill a turn between capture and completion and then ask what the next turn diffs from.

GAP 2 — CAPTURE FAILURE. You wrote "failures log and the turn proceeds", which is the right
direction: degrade to base behaviour rather than block the user's turn. But it needs a test, because
the failure mode has two halves and only one is obviously safe. The turn proceeding is safe. What the
COMPLETION then diffs from is not automatically safe — it must fall back to `turn/N-1`, and it must
not silently diff from a pending ref belonging to an earlier turn. Test: make the capture fail, assert
the turn completes AND the card is the `turn/N-1` diff, named as such.

TTFT: six Codex turns on the subscription, go. The scratch workspace populated from this tree so the
capture pays 21k files is the right harness — a fixture-sized tree would measure nothing. Report
min/median for both arms as you said, and state in the body that the snapshot-skipped arm was produced
by a scratch-only env check, so nobody reads it as a shipped flag.

ENUMERATION: this is what 282 was asking for and the two entry flags, the stat comparison with its
racy escape, fsmonitor and the untracked cache — each with a constructed losing case — is the
enumeration. Note in it which were measured tonight by construction and which are argued from git's
rules; the distinction is the whole value.

Both gaps before #72 is PR ready. Neither blocks #73.
