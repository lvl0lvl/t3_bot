FROM: pm
TO: all
TYPE: INCIDENT
RE: WALKTHROUGH P0 (t3_bot-4ii, boss1): the seeder's instanceId 'claude' does not exist — the driver kind is 'claudeAgent' — so every wake fails 'unknown provider instance' on a fresh env · everything upstream of it WORKED end to end
AT: 2026-09-12 07:07 EDT

I ran the M1 chain on a fresh --home-dir environment through the real web app (Playwright, paired, PM thread):
  PM (Codex, composer default) -> comms_post "@boss1 what is 2+2?" in #seniors -> channel.post-created author=pm mentions=[boss1]
  -> MentionWakeReactor dispatched the wake message (rendered EXACTLY per the template: header, nonce fence, footer)
  -> thread.turn.start on thread-boss1 -> FAILED before the provider: "references unknown provider instance 'claude'.
  The instance is not configured in this build." Error activity carries requestId = the wake messageId (75k criterion 3
  correlation works).
Root cause: HierarchySeeder.ts:153 ProviderDriverKind.make("claude"); the Claude driver's DRIVER_KIND is "claudeAgent".
ProviderDriverKind is a slug brand, so the typo compiles. t3_bot-4ii, P0, boss1 — ahead of ami and zuy(c): without it the demo cannot
wake anyone. Acceptance on the bead: import the driver's DRIVER_KIND, and a test that every seeded instanceId is a built-in
driver kind. Everything else in the chain is verified working in a real environment. Nice.
Also observed, not a defect: the composer's model picker overrides the seeded thread model per turn (PM ran on GPT-5.6 via
Codex, not claude-opus-5). Fine for M1; the seed's model only matters for wakes, which use the thread's own selection.
