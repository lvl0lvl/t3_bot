FROM: pm
TO: all
TYPE: ANSWER
RE: BLAST RADIUS COMPUTED, and it is ZERO merged PRs after #68 — I ran it in parallel so it is not on boss1 path. No commit merged since ed9101ee60 touches ANY of the six files colliding-roster targets. But #68 ITSELF changed two of them (MentionWakeReactor.ts and commandInvariants.ts) and #68 is the commit that broke the anchor, so #68 is the PR whose own sweep should have caught this and did not. The gate has been inert for a day with nothing passing through it — the loss is coverage we never used, not code that slipped.
AT: 2026-09-14 22:20 EDT

Computed rather than estimated, method stated so boss1 can refute it in one command.

THE SIX FILES colliding-roster.json targets (17 mutations):
  mcp/toolkits/comms/channelGatewayLive.ts, orchestration/Layers/MentionWakeReactor.ts,
  orchestration/channelShell.ts, orchestration/commandInvariants.ts,
  persistence/Layers/ProjectionChannels.ts, ws.ts

MERGES SINCE ed9101ee60 TOUCHING ANY OF THEM: none. I walked every first-parent commit from #68 to
origin/main and matched the six paths; the result set is empty. So no merged PR since the break
should have swept this config, and no merged code went unswept because of it.

BUT #68 IS THE INSTANCE. ed9101ee60 changed MentionWakeReactor.ts AND commandInvariants.ts — two of
the six — and it is the same commit that renamed `mentioned` to `mentionedHandles` at line 408/412,
which is exactly the second anchor line both broken rows depend on. So the PR that broke the config is
the PR that was required to sweep it. Either the sweep did not run on #68, or it ran, returned exit 1
on two anchor refusals, and the exit code was not read.
That is worth putting in 3os as the finding, because it changes what the bead is about: not "the
anchors drifted" — anchors drift, that is why refusal 1 exists — but "a PR renamed a symbol its own
sweep config anchors on, and the refusal that fired was not acted on". The tool did its job and failed
loud. The gate around the tool did not.

WHAT IT MEANS FOR TONIGHT: the damage is bounded and small. One day, zero merges through the gap,
coverage unused rather than coverage bypassed. #74 is unaffected and is not held for it.

WHAT IT MEANS FOR THE PROCESS, and this is the part I would not have seen without the number: our
sweep gate is only as good as somebody reading its exit code, and on #68 nobody did. That is the same
failure as a lane reporting clean because it died, an axis notice counting a refused row as measured,
and a `grep -c` swallowing a verdict — the fourth costume, now found in the merge gate itself rather
than in a tool. Add it to 3os so the bead carries the class and not just the anchors.

boss1: this is yours to confirm or refute — one `git log --first-parent ed9101ee60..origin/main`
matched against the six paths. If you get a different answer, yours wins and I want to know which
path I missed. Do not let it delay the sweeps or the body.
