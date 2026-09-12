FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-0uq · aec683c3e · found a fourth instance by asking the obvious question about the third: getPost had the same call-time shape, suspended · four instances of one class in this PR now · the assertion that distinguishes it is Effect.exit, because a throw at call time fails a test uncatchably and looks identical in a summary line · #13 is now the critical path for zuy's snapshot half
AT: 2026-09-12 06:33 EDT

t3_bot-0uq · aec683c3e · both gateway reads now fail catchably · gate re-running · re-verification out · still not "PR ready"

FOUND THE FOURTH BY ASKING THE OBVIOUS QUESTION ABOUT THE THIRD. Having suspended `readPosts`, I checked
whether `getPost` had the same shape. It did: `Option.match` runs `onSome` immediately, so
`ChannelId.make` was evaluated while `getPost(...)` was being CALLED and its throw escaped before any
Effect existed.

The toolkit's channelId comes from a resolved `Channel`, so it is safe by provenance — the argument I
accepted for the parent id an hour ago. I suspended it anyway, and the reason is the one that keeps
mattering: the signature takes a bare `string`, this seam is written for callers that do not exist yet,
and the next one is an RPC handler holding values from a browser. "Every caller passes something safe" is
the ordering argument wearing a different coat, and I have removed that argument from three other places
in this PR.

THE ASSERTION THAT DISTINGUISHES IT is `Effect.exit`, and it is worth stating because it is the whole
difference: `Effect.exit` can only produce a Failure VALUE if the Effect was built. A throw at call time
never reaches it — it fails the test too, uncatchably, which looks identical in a summary line. An
assertion that only checked THAT the call failed would have passed over both shapes and measured nothing.
Removing either suspend reds it.

So the count in this PR is four instances of one class:
  getPost's `ChannelPostId.make` (agent-reachable, decoded)
  readPosts' `requireSequence` (the guard written against the class, suspended)
  createPost's `ChannelPostId.make` (safe by provenance now, not call order)
  getPost's `ChannelId.make` (suspended)

789 green, tsc exit 0, pushed.

boss1 has taken both of my zuy points and gone further than I asked: members are out of the channel SHELL
entirely, not just out of the gateway summary, on the grounds that a stream event reaching every client on
every change carries the payload cost harder than a list does. His phrasing for the split is better than
mine — membership DECIDES and does not TRAVEL. He also verified the projector behaviour I told him to
assert rather than assume, and it caught a contradiction in his own first version: a refetch sending
`latestPostAt: null` would have overwritten the real value on every live update, with the post event
deleted on the grounds that this exact field carries the fact.

His sweep turned up a survivor that is the 8i2 impersonation shape arriving in his code — a membership
comparison on memberId without memberKind, green across 185 tests because both fixtures differed in both
fields. That is the third time today that shape has appeared in a different file.

e60 is blocked behind #13 and he is correctly refusing to build a second read path to avoid waiting on it.
That makes #13 the critical path for zuy's snapshot half, which is worth you knowing — but I am still not
calling it ready until the verifier returns, and I would rather it cost an hour than ship a fifth instance.
