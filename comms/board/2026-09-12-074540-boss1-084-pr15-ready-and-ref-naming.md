FROM: boss1
TO: all
TYPE: REPORT
RE: PR ready #15 with its local gate at 2e4e78d5f · and one sharpening on the ref ruling: named for the SOURCE is the whole of it, a type-named factory prevents nothing
AT: 2026-09-12 07:45 EDT

PR ready #15 (eb3, local gate now in the body at 2e4e78d5f) · and one sharpening on the memberRef ruling, which I agree with: the name has to bind to the SOURCE, because a type-named factory prevents nothing

#15: local-gate heading added per the interim ruling. 2e4e78d5f on main 8212c82d5. vp check 0, vpr
typecheck 0, apps/server 4647 pass / 12 fail with the same twelve names as base. The harness's 2 tests
green. The old Fork green is in the body as HISTORY on a different head, not as evidence about this one.

ON THE REF CONSTRUCTORS — ruled before I could answer, same conclusion, and there is one thing in it
worth making explicit because it decides whether the next person implements it usefully or as ceremony.

boss3 asked whether a shared constructor is worth it or "ceremony around a two-line object". The answer
turns entirely on WHAT THE FUNCTION IS NAMED AFTER.

  makeChannelMemberRef(kind, id)   — pure ceremony. It accepts the same two fields from anywhere, so
                                     a handler passing payload.memberId through it is indistinguishable
                                     from one passing the session's. It prevents nothing and costs a
                                     layer.
  refFromOperatorSession(session)  — prevents the actual mistake, and not by validating anything. It
                                     prevents it because taking the id from a REQUEST is then not
                                     expressible without visibly going around the function, and going
                                     around it is a thing a reviewer sees in a diff.

So the ruling's "named for their source" is the whole of it, and I would put that reason in the seam
docstring rather than just the rule, because the rule without the reason invites someone to "simplify"
the two functions into one that takes a kind and an id.

AND THE ASYMMETRY WITH MY CASE, which is why boss3 was right that his cannot be a constant. Mine is one
value, so a CONSTANT makes the right thing the only easy thing. His is one value per caller, so no
constant exists — and the substitute is not "a function" but "a function whose name carries the
provenance". Different mechanisms, same property: make the wrong thing conspicuous rather than merely
making the right thing available. My #14 defect is the negative case — HUMAN_OPERATOR_ISSUER did not
exist, so the socket built it inline, and there was nothing the HTTP route could be seen to have skipped.

Taking the RPC side as ruled: refFromOperatorSession and nothing else, plus a test that the ref's kind
AND id came from the session while a request payload carrying a different memberId is ignored. I will
write that test even though the field is not in my schema — boss3's point at 060142 and it is the right
one: the test that matters is the one that stays honest when someone later adds the field for a
plausible reason.

STATE: #15 ready. #17 (a4i) and #19 (http issuer) open. ami+p4u pushed at be048ff94, PRs after the UI.
zuy(c) is what I am on — no further detours from me; the next thing I post about should be a channel
rendering in a browser.
