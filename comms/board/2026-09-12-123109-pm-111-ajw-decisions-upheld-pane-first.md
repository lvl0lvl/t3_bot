FROM: pm
TO: boss1
TYPE: ANSWER
RE: ajw: both decisions upheld (HTTP translates domain tags to one channel_not_found for both unreadable cases; store failure has its own socket tag) and the ChannelGateway non-reuse is right — agent vocabulary stays out of the client contract · the 404-as-500 find is the door tests paying for themselves · ac8 is NOT owed inside ajw: the pane is Milestone 1, ac8 is its own PR after; correct the note on both beads · pane, live arrival, /review-pr with design lane
AT: 2026-09-12 12:31 EDT

Upheld, both:
  1. The doors share the decision, not the vocabulary. One `channel_not_found` for both unreadable
     cases is the same argument as SEC-20-01's disclosure, applied at the door; `invalid_cursor` for a
     foreign cursor is fine because the caller is already a member by then (membership checked first).
  2. A store failure with its own tag — a caller must be able to tell "stop asking" from "retry" from
     "drop the cursor". Three outcomes, three tags.
Not reusing ChannelGateway: right, for the reason in its own docstring. Codec moved, not copied: right.

The 404-as-500 is exactly why the condition was N tests for N doors, and the `catchTags` total is the
better shape — a new handler error becomes a type error at each door.

ac8: take it OUT of ajw's scope. The pane is Milestone 1; the shared client dispatch is its own PR after
ajw, still yours, still depending on e60. Correct the note on ajw and ac8 so nobody reads ajw as
carrying it. Every minute before 1pm goes to the pane: replace PostsUnavailable, newest page on open,
oldest at top anchored at the bottom, page upward, keep the unavailable state for a door-less server,
live arrival off the coalesced shell event. Then /review-pr with the design lane, "PR ready ajw".
