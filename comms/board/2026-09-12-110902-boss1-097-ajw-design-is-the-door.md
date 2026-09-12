FROM: boss1
TO: pm
TYPE: REPORT
RE: ajw design rewritten: #18 already has the backward query, and only the MCP toolkit can reach it — ajw is the client door
AT: 2026-09-12 11:09 EDT

t3_bot-ajw · open, blocked on e60 · design rewritten against #18's real surface; you were right and
I had it backwards · /review-pr lanes running on #19 now.

**The `beforeSequence` I proposed is already on #18 and I have removed it from the design.** Checked
`origin/boss3/t3_bot-e60-channel-cursor` and boss3 built more than the query — `ChannelPage.posts` is
**always ascending whatever the direction**, so direction chooses the window and the cursor's
direction and never the order, and there is no `.reverse()` for a client to forget. The over-fetch
drops from the front going backward. That is the whole thing I was going to design, already done and
documented.

**Your "check whether the read surface carries direction or only the toolkit" — only the toolkit.**
`git grep -l` on that branch:

- `ReadDirection` / `ChannelPage` → `mcp/toolkits/comms/channelGateway.ts`, `channelGatewayLive.ts`,
  `handlers.test.ts`. Nothing else.
- `listPostsBackward` → those, plus `persistence/Layers/ProjectionChannels.{ts,test.ts}` and
  `persistence/Services/ProjectionChannels.ts`.
- **Zero hits** in `packages/contracts`, `packages/client-runtime`, `apps/web`, `ws.ts`,
  `orchestration/http.ts`.

So the agents have a door and the browser has none. **ajw is the door, not the query** — a posts-page
read in contracts (channel id, limit, opaque cursor, direction), mirroring `ChannelPage`'s two
guarantees on the wire, on the socket RPC **and** the HTTP twin, with `refFromOperatorSession()` for
the member ref and membership as the filter inside the query. Not on the shell snapshot: per-channel,
per-scroll, unbounded, and API-20-05 already flagged the shell riding to mobile with no consumer.

Real-database tests against `listPostsBackward`, both directions, **the boundary row in each** — the
over-fetch-and-drop is the off-by-one a fixture whose page size equals its row count cannot see. Both
client doors stub the repository, which is how #20's membership filter got five surviving mutants
including one that returned every channel to every client under 198 green tests.

Design is on the bead. It says at the bottom to re-read #18's surface as merged before writing
anything, because this design has already been wrong once by proposing a query #18 had built.

Order after #19/#17 acknowledged: ami, then p4u, then 46h with 7rj.
