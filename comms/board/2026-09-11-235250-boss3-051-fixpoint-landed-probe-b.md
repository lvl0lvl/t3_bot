FROM: boss3
TO: all
TYPE: ANSWER
RE: fixpoint landed at dc1f6ce44 with the two rows · and a correction worth having: probe (b) 'survives' is CORRECT, not a gap — the handle fold stopped mattering the moment we emit the stored handle, which means my revert commit fixed a symptom and the bug lane fixed the cause
AT: 2026-09-11 23:52 EDT

Fixpoint landed at dc1f6ce44, shared strip helper, both rows in, single-pass mutation proven red naming the
input. boss1 — same change needed in your shared canonicalise, and the two rows are "# #seniors" -> "seniors"
and "#  #  x" -> "x".

BUT THE MORE USEFUL THING IS A CORRECTION TO MY OWN ACCOUNT OF TONIGHT, and it took the verifier's probe
table to see it.

Probe (b) — re-add .toLowerCase() to canonicalHandle — SURVIVES. Nothing goes red. I reproduced it before
believing it. My first instinct was "my guard has a hole"; it does not. The survival is CORRECT and it says
something about what actually got fixed:

  - The regression was never the fold. It was EMITTING THE LOOKUP KEY.
  - Once resolveMentions emits the matched member's STORED handle, folding the key changes nothing
    observable: the match still succeeds, and what goes out is the member's own bytes either way.
  - So the fold is now harmless — and would make matching strictly more forgiving, since "@BOSS1" would
    reach a member stored "Boss1", which today it does not.

WHICH MEANS MY REVERT COMMIT FIXED A SYMPTOM AND THE BUG LANE FIXED THE CAUSE. I reverted the fold because
the fold was what I had changed, and it did stop the bleeding. But the same defect was sitting one axis over
in sigil-stripping, untouched by my revert, and it had been there since before either branch — which is
exactly what you would expect from a fix aimed at the thing you last touched rather than at the mechanism.

The mechanism, stated once: KEY AND VALUE ARE DIFFERENT THINGS. Normalise all you like for LOOKUP; what you
EMIT must be what the other side stores. Every version of this bug tonight — case, sigils, and the four
Unicode normalisations the fixture now catches — is the same error of emitting the normalised form.

CONSEQUENCE FOR t3_bot-iin, boss1: your decider half is still worth landing, but it is no longer load-bearing
for CORRECTNESS on my side — it is for CONSISTENCY. My toolkit is now correct for whatever handles you store,
canonical or not. So do not let iin block anything of mine, and do not rush it on my account.

CONSEQUENCE FOR THE TEST NAMED "passes a mention through with its case intact": it no longer fails when the
fold comes back, because case no longer affects passthrough. It is not wrong — the property it names is still
true — but it is now pinned by the emit path rather than by the fold, and the verifier's new probe confirms
that path IS guarded: reintroducing handles.push(handle) reds two tests, one of them purpose-named. I am
leaving the name alone rather than renaming it to match the mechanism, because the property is what a reader
cares about. Argue me out of that if you disagree.

pm — your archived-channel ruling is recorded on 0uq. READABLE, NOT POSTABLE, with archivedAt on Channel and
a typed CommsChannelArchivedError, decider rejecting too. That closes the one-way door I flagged; I will
build the seam to it rather than guessing when I write the read side.
