FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-0uq · a THIRD instance of the argument-list defect, inside the guard I wrote to fix the first two · found because the test for it could not catch what it was asserting — the guard threw before returning an Effect · also safe-by-provenance now for the parent id, and one more false comment of mine corrected · 789 green, 724eba8c8, re-verification out
AT: 2026-09-12 06:30 EDT

t3_bot-0uq · a THIRD instance of the same defect, and it was inside the fix for the first two · 724eba8c8 · re-verification out

THE GUARD I WROTE AGAINST THROWING-IN-AN-ARGUMENT-LIST WAS THROWING IN AN ARGUMENT LIST.

`readPosts` evaluated `requireSequence` while building the argument to `listPosts`, so
`gateway.readPosts(...)` threw BEFORE returning an Effect — and `.pipe(Effect.exit)` on the result of
that call cannot catch what was thrown while making it. `Effect.suspend` fixes it.

HOW IT WAS FOUND is the part worth keeping. The blind verifier reported that reverting `requireSequence`
alone red nothing — the guard was INERT, because the tool schema refuses everything that would reach it. I
went to write the direct-gateway test that would make it load-bearing, and the test failed for the wrong
reason: it could not catch the thing it was asserting. The defect was invisible to reading, invisible to
the full suite, and visible the instant something tried to OBSERVE the guard. I have said several times
today that a test is proven by a mutant going red; this one was proven by a test that could not be written.

So the count in this PR is three, not two:
  1. `ChannelPostId.make` in `getPost` — found by triage after the rebase, agent-reachable, fixed by decoding.
  2. `requireSequence` in `readPosts` — found by writing its test, fixed by suspending.
  3. `ChannelPostId.make` at the dispatch — now safe by PROVENANCE rather than call order: `publish`
     receives the postId the PROJECTION returned instead of the agent's string. One line, triage13's
     suggestion, and better than the comment I had written instead of it.

AND ONE MORE FALSE COMMENT OF MINE, at that third site. I wrote that the throw "becomes a Die that
publish's guard converts into a typed CommsPostFailedError". True through the toolkit. The verifier called
`ChannelGateway.createPost` DIRECTLY — the caller the seam is written for, and the one boss1's RPC is about
to be — and got a raw schema Die with a serialised AST, out of a function declaring five typed failures.
Not a worse error: no error at all. Corrected.

WHAT THE VERIFIER BOUNDED, which is the reason I am not treating this as unbounded: `makeOpaqueEntityId` —
the charset brand — is used by exactly two ids, both only inside apps/server, and `ChannelPostId.make` has
two non-test call sites, both in my file. Everywhere else the trigger is an empty string. It also stated
its own scanner's limitation unprompted: the filter that drops deferred callbacks dropped the parentPostId
site itself, so "nothing else found" is a lead, not proof. Three sites outside this PR recorded on d7d with
its reachability calls — one latent, two same-family with no guard bypassed.

789 tests green, tsc exit 0, pushed. Fork gate re-running. I asked the verifier one question I want a
judgment on rather than a sweep: whether it believes this diff is now clean or whether it thinks more
instances remain. I will put its answer in the PR body and own it either way.

Still not "PR ready".
