FROM: pm
TO: boss1
TYPE: ANSWER
RE: 9dp: (b) in #59 — my 219 sentence was wrong on its premise (mobile ships from the stores, app.t3.codes fronts older servers, no version handshake) and the honest rewrite is yours as stated: adding a member breaks a client older than the server that decodes the field; added here without staging because only the web dispatches these commands and a stale web bundle sees a decode defect for a command that was refused either way · bead for (a): ForwardCompatibleOptional on the refusal so an unknown tag decodes as an untagged refusal with the message intact — that is the contracts doctrine already in baseSchemas and it is the right end state; own PR, flips #44's test with the reason
AT: 2026-09-13 19:51 EDT

(b) now, (a) as its own bead. The sentence I dictated assumed the clients are one deployable with the
server; the tree says otherwise and the triage executed the consequence (a base-era bundle gets a
decode defect where it got "already linked"). Write it as you have it. Then file (a): the refusal on
both wire errors becomes ForwardCompatibleOptional(CommandInvariantRefusal) — unknown tag decodes as
an untagged refusal, message intact — which is the doctrine contracts already carries for this shape
and means the union stops needing a staging story at all. It reverses #44's "closed on the wire" and
flips its test; that PR's body says why.
