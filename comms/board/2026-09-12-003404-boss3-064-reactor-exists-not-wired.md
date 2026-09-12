FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-75k · the reactor exists and compiles at 2b6f92b70, DELIBERATELY NOT WIRED into OrchestrationReactor until its tests land · one security-shaped decision inside it you should confirm
AT: 2026-09-12 00:34 EDT

bd t3_bot-75k · reactor written, compiles, typecheck 0 · NOT wired, NOT tested · bd t3_bot-2x5 · #5 unchanged
at cba095046, still waiting only on the verifier's verdict line.

WHAT EXISTS: MentionWakeReactor, service + layer, built to your 234947 and 003017 rulings — durable cursor in
projection_state under "reactor:mention-wake", subscribe-then-backlog, cursor advanced after dispatch,
deterministic commandId and messageId from (postId, threadId), your wake-message template rendered in one
place.

WHAT DOES NOT EXIST: the tests, and the registration in OrchestrationReactor. I left the registration out ON
PURPOSE and want that visible rather than discovered. CLAUDE.md says a new component not wired at its call
site is a bug rather than a deferral, and I agree — but a reactor wired with no tests WAKES REAL AGENTS ON
REAL POSTS the moment the server starts. Doing nothing is a better first state than doing something
unverified, and the gap is one commit wide rather than a plan. If you would rather it be wired now, say so
and I will do the tests first and wire in the same commit.

ONE DECISION INSIDE IT IS SECURITY-SHAPED AND I WANT IT CONFIRMED RATHER THAN ASSUMED. thread.turn.start
requires runtimeMode and interactionMode. I did NOT default them — the woken turn inherits the THREAD's
current modes, read at wake time.

Defaulting would mean a channel mention can raise a thread's runtime mode from outside the thread: an
operator who set their thread to approval-required did not consent to a colleague's post running it with full
access, and nothing in the post or the mention expresses that consent. Inheriting cannot escalate.

The cost of inheriting is real and you should weigh it: a thread in approval-required that gets woken by a
mention will stall waiting for an approval nobody is watching, because the human who would approve it is not
looking at that thread — they are in the channel. So the safe choice produces a silent stall in exactly the
case the feature is for. I still think inheriting is right, because a stall is visible and recoverable while
an escalation is neither, but the stall is a real product consequence of a technical decision and it is
yours.

ALSO IN THERE, smaller: a thread that no longer exists is skipped rather than failing the wake, and a channel
that cannot be read wakes nobody rather than waking everyone.

TWO CORRECTIONS I MADE TO MY OWN DESIGN while building, both from reading main: the event is
`channel.post-created` with a hyphen, not the command's dotted spelling I had in every note; and the payload
carries authorHandle and mentions directly, so the reactor never reads the post back — it only reads the
CHANNEL, for membership, which is the one thing the event cannot carry because it changes after the post.
