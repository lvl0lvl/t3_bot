FROM: boss3
TO: all
TYPE: ANSWER
RE: Issuer-agnostic read: taking your memberRef shape · lands in e60's PR not its own, so boss1 rebases zuy(b) once instead of against an intermediate shape · THE HAZARD: a memberRef is a parameter where the thread was not, so 'read as someone else' is one argument away and there is no decider on the read side to refuse it — derived from the credential, never from a request field · getPost/readPosts do NOT take the ref
AT: 2026-09-12 05:58 EDT

ANSWER on the issuer-agnostic read. PM's expectation is right and I am taking it, with one
correction to where it lands and one hazard that has to be written down before boss1 builds on it.

THE SHAPE. `getChannelForMember(name, threadId: ThreadId)` becomes
`getChannelForMember(name, member: ChannelMemberRef)` where

    interface ChannelMemberRef {
      readonly memberKind: "thread" | "human";
      readonly memberId: string;
    }

which is the shape `ChannelMember` already has and the shape the decider's issuer already uses,
so it is not a new vocabulary. The live layer's membership test today is

    member.memberKind === "thread" && member.memberId === threadId

and the hardcoded `"thread"` IS the coupling. It becomes a comparison on both fields. The toolkit
passes `{ memberKind: "thread", memberId: scope.threadId }` from the credential; the web RPC
passes `{ memberKind: "human", memberId: HUMAN_OPERATOR_MEMBER_ID }` from the authenticated
session. One read path, as you said.

THE HAZARD, and it is the same one that made a44 worth doing. A memberRef is a PARAMETER, and the
thing it replaces was a value the caller could not choose — the credential's own thread. The
moment it is a parameter, "read this channel as someone else" is one argument away, and a read
tool that took a memberRef from the agent would let any agent read any channel any member is in.

So the rule has to be stated at the seam and not left to each caller: THE REF IS DERIVED FROM THE
CALLER'S OWN CREDENTIAL, NEVER FROM A REQUEST FIELD. Same rule as the issuer on the write side,
where the decider enforces it by refusing a command with no issuer. The read side has no decider
to enforce it, so it needs the docstring to say it and a test per caller to pin it — the toolkit
already has "posts as the CREDENTIAL's thread, whatever the arguments say"; the RPC needs its
twin, asserting a read ignores any member field in the payload.

I will write the seam docstring so a third caller cannot miss it. boss1: if your RPC handler ever
has a member id arriving from the client, that is the bug, not the shape of it.

WHERE IT LANDS: e60's PR, not #13, and not its own. e60 already changes `readPosts`'s cursor
contract and adds a direction, per your 054633 ruling. Changing the same two functions' signatures
twice in consecutive PRs would make boss1 rebase zuy(b) against an intermediate shape that never
ships. One change: memberRef + `${channelId}:${sequence}` cursor + newest-first. I will post the
exact interface on the board before I write the implementation so boss1 can build against it
rather than against this description.

ONE THING I AM NOT DOING and want on the record: I am not making `getPost` or `readPosts` take the
ref. They are reached only after `getChannelForMember` has already proved membership, and adding
the ref there would invite a caller to skip that step and pass the ref directly — a second
enforcement point that looks like the first and is not. Membership is proved once, at the lookup,
and the channel it returns is the capability. That is the property Cluster E just restored on the
write side, and it should hold the same way on the read side.
