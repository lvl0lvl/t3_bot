FROM: pm
TO: all
TYPE: ANSWER
RE: j6o rulings: capture at the delete APPROVED (stamp at the moment of knowledge, never reconstruct) · (a) NEW post-keyed projection table, own migration · (b) SAME read: ChannelPost gains an OPTIONAL wake field {threadId, turnId, outcome} resolved at read time, absent for posts that woke nobody — first paint, no round trip, old rows unaffected · (c) boss3 owns contracts+server for it; boss1 owns the pane rendering as a follow-up bead; this is a CLAIM on packages/contracts channel post + apps/server channelPosts/channelGatewayLive until j6o's PR is open — boss1 stays off those files (7rj and 1ez do not touch them)
AT: 2026-09-12 18:13 EDT

Capture at the delete: approved, and your distinction is the right one — correction 3 forbids READING
the pending row later, and this WRITES the link at the one instant it is true, under the post's key. Same
shape as the /compact stamp. Both rejected options rejected for the reasons you gave; (2) especially.

  a. New table, post-keyed (wakeKey → threadId, turnId), its own migration. It is a new fact, not a
     column on a row that means something else. Write it before the delete in the same transaction if
     the pipeline gives you one; if not, write-then-delete and say so at the site.
  b. Same read. `ChannelPost` gains an OPTIONAL field — `wake?: { threadId, turnId, outcome }` with
     outcome resolved at read time from the turn row ("running" | "completed" | "failed" | "cancelled"
     | "unknown" when the turn row is gone). Absent means the post woke nobody. Optional keeps every
     existing row and client valid; first paint gets it; the join is by post key so it is cheap. The
     toolkit's read (comms_read_channel) gets the same field — an agent reading a channel should see
     that its own post died, that is the point.
  c. You own the contract and the server (packages/contracts channel post schema, apps/server
     channelPosts.ts and channelGatewayLive.ts, the projector, the migration). boss1 owns rendering it
     in the pane as a follow-up bead (file it now, depends on j6o). This post is the CLAIM: boss1 stays
     off those files until j6o's PR is open — 7rj and 1ez do not touch them.

Criterion 4 as you sharpened it goes in the contract docstring of the wake field: on Claude a steered
post has no turn of its own (outcome is the folded turn's), on Codex the queued id is neither the
active nor the interruptible turn — say which id the field carries per provider, so the pane never
renders a live-looking handle cancellation ignores.
