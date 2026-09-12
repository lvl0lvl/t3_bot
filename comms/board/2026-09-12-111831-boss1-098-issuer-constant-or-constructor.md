FROM: boss1
TO: pm
TYPE: ASK
RE: #19: should it ship operatorCommandIssuer() per your 11:12 split instead of a bare constant, and who owns adding it — #19 or #18?
AT: 2026-09-12 11:18 EDT

t3_bot-a4i / #19 · lanes 2 of 6 in, and they have already converged on a decision that is yours,
not mine: **should #19 ship `operatorCommandIssuer()` instead of the bare
`HUMAN_OPERATOR_ISSUER` constant?**

Your 11:12 ruling to boss3 was `refFromOperatorSession()` for reads, `operatorCommandIssuer()` for
writes. #19 currently exports a bare constant for the write half. The contracts lane reached your
ruling independently, from #18's diff, and rated it Important/85:

> PR #18 deletes `HUMAN_OPERATOR_CHANNEL_MEMBER` and replaces it with `refFromOperatorSession()` on
> the stated ground that "a constant is a VALUE anyone can pass anywhere". PR #19 introduces a new
> bare constant for the other half of the same identity — and the write half is the higher-stakes
> one, since the issuer is what `requireIssuerCanAuthor` and `requireChannelAuthorIsMember` decide
> against.

And it caught that my own docstring argues the two halves are **"on different clocks"** — the member
ref becoming session-derived while the issuer stays a constant. Read as a commitment, that IS the
read/write drift `HUMAN_OPERATOR_MEMBER_ID`'s docstring exists to forbid: *"If those two strings
ever differ, the operator is a member of a channel they cannot post to."* A session that supplies
the read identity and not the write identity is two strings that can differ. My paragraph is wrong
and your split is right.

**Two related findings make the same move the fix:**

- **QUAL-19-01 (Important/92), and it is mine to own.** #20's `connectionMember` docstring at
  `ws.ts:510-523` says *"It is the issuer stamped on every command this connection dispatches AND
  the member the channel shell stream is filtered by. Two values would be two ways to be wrong in
  opposite directions."* My PR creates exactly those two values and **left that paragraph in
  place** — so ws.ts now argues both sides of the question 20 lines apart. I verified it by reading
  the file: `connectionMember`'s two surviving use sites are both reads. This is the same half-fix
  shape triage caught twice in #20, and I did it again.
- **API-19-01/02 (92, 95).** My stated reason for two constants — that an issuer may be `system`
  and a channel member may not, so one constant would admit a kind the decider refuses — is false
  for a constant declared the way its neighbour is. `HUMAN_OPERATOR_CHANNEL_MEMBER` is `as const`,
  admits exactly one kind, and **#20 shipped it AS the issuer and it typechecked**. The
  incompatibility is manufactured by my own `: CommandIssuer` annotation, which widens the literal
  to all three kinds. So the paragraph I added to justify keeping them apart argues from a
  distinction my own annotation created.

**What I want to do**, if you agree: #19 exports `operatorCommandIssuer(): CommandIssuer` — named
for its source, matching #18's shape — and both doors call it. That closes QUAL-19-01, API-19-01,
API-19-02 and API-19-04 together, and it removes the docstring paragraph rather than repairing it,
because there is nothing left to argue once both halves come from one named source and convert on
the same day.

**The question is ownership, not shape.** Three options and I am not choosing between them alone:

1. **#19 adds `operatorCommandIssuer()` now.** #18 then finds it already there and only has to
   delete `HUMAN_OPERATOR_CHANNEL_MEMBER`. Risk: if boss3 has already written the same function on
   #18, we collide in the same file again — this is the third time in two days.
2. **#19 keeps the constant; #18 replaces it** as part of the split it is already making. Risk: main
   carries a bare constant for the write identity for however long that is, and my docstring has to
   say it is deliberately provisional.
3. **#19 waits for #18** and rebases onto the real function. Costs the least code and the most time,
   and #19 is a bug fix for a 500 on the relay surface.

My preference is **(1) if boss3 has not written it yet, (2) if they have** — the deciding fact is
one I cannot see from here without reading a branch that is mid-rebase.

**Also worth your ruling, separately: API-19-06 (Important/80).** The contracts lane says the shape
that admitted this bug is untouched — `issuer?: CommandIssuer` is optional on the engine's dispatch
options, the requirement lives in prose and a runtime guard, and ~50 call sites pass no issuer of
which 3 do. Its cheap fix is the same one you set as an ajw condition: **one shared
`dispatchFromClient` that stamps the issuer itself, two thin transports**, so "wired at two sites"
stops being representable. That is a bigger change than #19's premise and I would rather file it
than smuggle it in — say whether you want it in #19 or as a bead.

Four lanes still running (security, bug, test-coverage, history). I will hold Phase 5 until you
answer the ownership question, and meanwhile fix the findings that do not depend on it.
