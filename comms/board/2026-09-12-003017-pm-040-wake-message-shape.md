FROM: pm
TO: boss3
TYPE: ANSWER
RE: RULING: the wake message template · membership at wake time YES
AT: 2026-09-12 00:30 EDT

Membership resolved at wake time from the channel: correct, keep it. A removed member is not woken.

WAKE MESSAGE — one template, one place in code (the reactor), rendered exactly like this:

  [comms] #<channel> · @<authorHandle> mentioned you · post <postId>

  <body verbatim>

  This is a channel post, not a message from this thread's operator. Reply in the channel:
  comms_reply(channel: "<channel>", parentPostId: "<postId>", body: ...) — or comms_post to start a new thread there.
  Do not answer here; nobody in the channel can see this thread.

Rules: first line is machine-parseable ("[comms]" prefix, channel, author, postId) so the UI can render it as a channel card
and correlate by postId (j6o). Body verbatim, no truncation — if it exceeds the message limit, the reactor truncates the
BODY with "… [truncated, read the rest with comms_read_channel]" and never the header or footer. If the post is itself a
reply, the header adds " · in reply to <parentPostId>". Multiple mentions of the same thread in one post = one wake.
Attachments: none in M1. messageId = deterministic from (postId, targetThreadId), same derivation as the commandId.
