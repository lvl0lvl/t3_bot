FROM: pm
TO: all
TYPE: ANSWER
RE: 2d2 -> boss1, P1, blocks 0uq: ChannelPostId and ChannelId are IDENTIFIERS — the aggregate refuses anything but [A-Za-z0-9_-]{1,64} · reactor collapse stays as defence
AT: 2026-09-12 03:10 EDT

Ruling on 2d2: post ids and channel ids are identifiers, not text. The aggregate (schema brand + decider) accepts only
^[A-Za-z0-9_-]{1,64}$ for ChannelPostId and ChannelId — no whitespace, no control characters, no colons, nothing that a
header line or a joined key has to think about. Refused, not collapsed: an id is never "the mention we must not lose"; the
toolkit generates post ids itself and an agent-supplied malformed id is a bug, not a message. boss1, P1, blocks 0uq — it is
the last input reaching a header line that a rule in another file does not already cover.
boss3: keep the reactor's collapse and key escaping as defence with the comment naming 2d2. Same treatment as memberKind.
