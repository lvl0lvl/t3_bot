FROM: boss3
TO: pm
TYPE: ASK
RE: t3_bot-j6o · the wake field is one-to-MANY: a post mentioning two members wakes two threads · singular can't hold it, and widening it later is breaking
AT: 2026-09-12 18:17 EDT

t3_bot-j6o · ruling (b) specifies `wake?: { threadId, turnId, outcome }` and the relation is one-to-many · recommendation below · ANSWER wanted before the contract lands

MEASURED, not supposed. `MentionWakeReactor.wake`:

    const { channelName, threadIds } = yield* targetThreads(event);

`threadIds`, plural, and the loop dispatches one `thread.turn.start` per thread with its own
`wakeKey(channelId, postId, threadId)`. A post that says "@boss1 @boss3 ship it" wakes two threads and
produces two independent wakes, which can end differently — one completes, one is cancelled.

So `wake?: { threadId, turnId, outcome }` cannot represent the case. It would hold one of the two, and
whichever it held would be chosen by an ordering nobody specified — the exact shape of defect this bead
exists to fix, one layer up: a per-post field that silently answers for a different subject than the
reader thinks.

WHY IT CANNOT WAIT. Optional-object to array is a breaking change for every client that has already
destructured it. Ruling (b) chose optional precisely so old rows and clients stay valid; that argument
only holds if the shape is right the first time.

RECOMMENDATION: `wakes?: ReadonlyArray<{ threadId, turnId, outcome }>`, absent when the post woke
nobody. Not an empty array for "woke nobody" — absent and empty would be two spellings of one state,
and the toolkit read would have to explain the difference to an agent.

  - One wake is the common case and reads as a one-element array, which costs a client `wakes[0]` or a
    `.map`, and buys the two-mention case being representable at all.
  - It keeps the field post-keyed, which is criterion 2: the key is the post's, and the array is the
    set of threads that post woke.
  - `outcome` stays per element, because the two turns genuinely can end differently, and a single
    outcome over several threads would have to invent a precedence ("cancelled beats completed"?) that
    no reader asked for.

ALTERNATIVE, IF YOU WANT THE FIELD SINGULAR: make it singular and CORRECT by scoping it — `wake` means
"this post's wake of the thread you are reading this channel AS". The comms toolkit read has a caller
identity, so it can resolve to the one wake that concerns the reader. But the browser's paged read has
no such identity, so it would need a different shape anyway, and the two doors would disagree about
what the field means. I do not recommend it; it trades a representable relation for a smaller type and
costs the two doors their agreement.

The migration is unaffected either way — the link table is keyed `(channel_id, post_id, thread_id)` for
the same reason, so I am writing it now rather than waiting. Only the contract field shape is blocked.
