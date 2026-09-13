FROM: boss3
TO: pm
TYPE: ASK
RE: t3_bot-1n6 · 218's item-id ruling rested on a false echo premise (5 lanes) · raw (A: matches #49 + other adapters; padded id breaks the brand and changes identity at replay) or decode (B: CLAUDE.md default; flips the padded test) — which?
AT: 2026-09-13 19:43 EDT

#58 review, all seven lanes in (11 merged findings; blind triage next). One is yours to re-decide, because board 218's item-id ruling rested on a premise five lanes falsified: I wrote that an admitted part id is carried raw "because it is echoed back to OpenCode in tool and question replies". It is not — no SDK call in the adapter sends a part id (permission.reply/question.reply send requestID only; callID appears once, inbound). The part id is T3-internal: ingestion keys `assistant:<itemId>` and `toolCallId`, and both clients trim the tool key themselves.

With the echo premise gone, the architect executed the brand shape and the persistence boundary: `RuntimeItemId.make(" prt_1 ")` keeps the padding, decode trims; ingestion writes `assistant:<itemId>` into a persisted orchestration event, and the event store decodes persisted events on read through the brand's decoder — so under raw carry a padded id keys `assistant: prt_1 ` live and `assistant: prt_1` after replay (a later live delta keys the padded form again), while under decode the key is `assistant:prt_1` on both sides.

Option A — carry raw (as merged, your 218 ruling): consistent with #49's turn-id door beside it and with every other adapter (Claude/Codex/ACP all `.make` item ids raw, no gate); breaks if a padded id ever arrives — the value typed RuntimeItemId violates the brand's documented invariant and its identity changes at the replay boundary. Option B — decode and carry the decoded value: honours CLAUDE.md's default ("decode, never .make, an id from outside the server") and the brand invariant, identity stable across live and replay; breaks if two OpenCode part ids differ only by whitespace (OpenCode mints prt_ ulids, so never), makes OpenCode the one adapter normalising item ids, and flips the padded-row test (the `.trim()` mutant that reds today becomes the contract). Neither is reachable from a real server; the choice is which invariant the type certifies.

The request-id half of 218 stands untouched (nothing here changes it); the architect adds that a truthy NON-string request id (42, {}) reaches `RuntimeRequestId.make` and throws in the pump — my body's "a .make there cannot throw" is true for strings only. I propose a one-line `typeof === "string"` narrowing in that spread (a type narrowing, not a gate) and correcting the body; say if you would rather just record it.

A or B for the item id? The rest of the findings (a Die in the drop log on a non-string part id — executed at head and base; the inert TestClock timeout; an unproven 64-char slice; log-per-event wording; comment shape) go to triage and the SE regardless.
