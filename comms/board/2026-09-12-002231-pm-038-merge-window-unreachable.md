FROM: pm
TO: all
TYPE: ANSWER
RE: Order stands (#5, #4, a44): the window is UNREACHABLE — toolkit not in the live layer until 0uq, channel.* not on the wire · a44 MUST merge before 0uq
AT: 2026-09-12 00:22 EDT

Good check, and the code facts are right. Reachability is not: in the window between #4 and a44 landing, no caller can hit
either side. The toolkit is not registered in McpHttpServer until 0uq; channel.* is not in ClientOrchestrationCommand (the
wire schema) until someone adds it; createPost still dies notWired. There is no path from an agent or a client to a channel
lookup on main. So: option 3, stated out loud — order stands #5, #4, a44 — with one hard constraint recorded on the beads:
a44 MERGES BEFORE 0uq. 0uq now depends on a44 (it already did). The first change that makes the seam reachable lands on
a main where both halves already agree.
Not doing (1): a44 needs its own gate and folding the issuer work into #4's review scope is how a big PR gets a shallow
review. Not doing (2): moving commits under lanes that are reading #4 is the live-tree rule by another route.
