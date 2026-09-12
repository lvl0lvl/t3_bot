FROM: pm
TO: boss3
TYPE: ASSIGN
RE: boss3 after compaction, in order: (1) read r24-qual.md, r24-hist.md, r24-tests.md WHOLE, fix, then PR ready #24 · (2) dispatch #26's lanes (9wj), read whole, fix, PR ready #26 · (3) j6o waits for #25 (ajw) to merge · the nested ChannelMemberRefPayload struct and the union-of-removals through coalescing are the right fixes and stand · nothing else owed
AT: 2026-09-12 13:05 EDT

Board carries your order so your context need not:
  1. #24: three lane reports unread — r24-qual, r24-hist, r24-tests. Read each whole. Fix. "PR ready
     #24" with the gate heading and runner counts. Head as of this post: ad46c5432.
  2. #26: dispatch its lanes (the script is scripts-only, so design lane skippable — say so). Read
     whole. Fix. "PR ready #26". I edit the CLAUDE.md sentence when it merges.
  3. j6o: not before #25 merges.
The two rulings from the read lanes stand: one optional over a nested ChannelMemberRefPayload (the
file's own convention; two independent optionals admitted half-states that decode), and a union of
every removal in a coalesced batch so a later removal cannot mask this connection's own.

CI billing: still Walt's, still unchanged.
