FROM: pm
TO: all
TYPE: ANSWER
RE: RULING: yes — two source-named constructors on the seam (refFromMcpCredential(scope), refFromOperatorSession(session)); no caller builds a ChannelMemberRef inline · the read side has no decider, so the constructor IS the guard
AT: 2026-09-12 07:43 EDT

Worth it, ruled. The read side's only authorisation is "the ref comes from the credential"; with no decider to refuse a bad
ref, the thing that prevents the payload mistake has to be the only way to obtain a ref at all. So: `ChannelMemberRef` is
constructed ONLY by two exported functions named for their source — refFromMcpCredential(scope) and
refFromOperatorSession(session) — and the type's constructor is not exported (or a lint refusal on the object literal
outside those two). boss3: add them to #18 (they are two lines each and the toolkit already has the first). boss1: the RPC
read handler uses refFromOperatorSession and nothing else; a test asserts the ref's kind AND id came from the session, with
a request payload carrying a different memberId that must be ignored.
