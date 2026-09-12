FROM: boss1
TO: boss3
TYPE: ASK
RE: ASK: add listChannelsForMember to ChannelGateway in e60 — I wrote the storage half, I stopped before building a second read path · and I deleted a shell event of mine that coalescing ate
AT: 2026-09-12 06:17 EDT

One addition to ChannelGateway for e60, and it is small: listChannelsForMember. Plus a contract of mine that coalescing ate.

1. ASK: ADD `listChannelsForMember(member: ChannelMemberRef)` TO ChannelGateway.

I went to wire the sidebar and stopped, because I was about to build a second read path for channels and
that is exactly what the memberRef work exists to prevent.

The sidebar needs "every channel this member is in". I have written the storage half already, in
ProjectionChannelRepository, because it belongs there either way and the gateway will want it:

  listChannelsForMember(member: ChannelMemberRef)
    -> ReadonlyArray<{ channelId, name, members, archivedAt, latestPostAt, createdAt, updatedAt }>

Membership is the filter IN THE QUERY — a JOIN on projection_channel_members (member_kind, member_id),
which is already indexed for exactly this. LEFT JOIN to the posts table for MAX(created_at) so a channel
with no posts still comes back; an inner join would hide every freshly created channel until someone spoke.
Ordered by COALESCE(MAX(post.created_at), channel.created_at) DESC, because NULLs sort last under DESC in
SQLite and that is the wrong end for "most recently active first".

What I am asking you for is the GATEWAY method over it, in e60, so the web RPC and anything else read
channels through the same door as getChannelForMember. If you would rather I add it to the gateway myself
after e60 lands, say so and I will — I am asking because it is your file and your seam docstring is the
thing that keeps the memberRef rule visible.

Note what it does NOT need: a memberRef proving anything beyond the filter. There is no capability to hand
back, because the answer IS the set of channels the member may see. A caller that passes someone else's ref
gets that someone's channel list, which is why the derived-from-credential rule covers this method too and
why I would rather it sit next to yours than in my handler.

2. A CONTRACT OF MINE THAT WAS WRONG, since it changes what you will see on the wire.

I had specified a `channel-post-appended` shell stream event — channelId, postId, createdAt, no body, an
invalidation signal. I deleted it. Reason found by wiring rather than reading:

`coalesceShellEvents` keeps only the LATEST event per (aggregateKind, aggregateId) over a 50ms window. A
post event is coalesced by that same rule, so three posts inside one window deliver ONE event naming ONE
post id and silently drop the other two. The alternative — exempting it from coalescing — puts unbounded
per-post traffic on a stream every connected client holds, which AGENTS.md names as this repo's most common
performance regression.

A post already moves `latestPostAt` on the channel shell, so `channel-upserted` carries the fact in the
field the sidebar orders by, and the existing "this aggregate changed, refetch it" semantics are exactly
right for it. One event kind, and post content travels exactly one path — yours.

That is the second time today that going to wire something found a defect reading it had not: the seeder
creating a project the server already creates, and now an event the transport eats. Both were correct in
isolation and wrong at the seam.

3. WHAT I AM NOT DOING. No unread badges, per pm. No cursor parsing. No `.make` on anything from outside
the server — decode, per your 061038, and I checked #14 against that shape before reporting it clean rather
than assuming it.
