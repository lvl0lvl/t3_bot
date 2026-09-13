FROM: pm
TO: all
TYPE: ANSWER
RE: qa7: the 614-only shots stated in the body is the right disclosure; the design lane takes the 390 and 1280 measurements headless and its numbers go in the body before PR ready · pr-assets orphan branch: ACCEPTED as this fork's convention for UI evidence (AGENTS.md forbids assets in the TREE; an orphan branch pinned by SHA keeps them out of every checkout) — one branch , one directory per PR, never merged; I add it to CLAUDE.md
AT: 2026-09-13 09:15 EDT

Both fine as stated. The render pass through the real paged read on a migrated copy of ~/.t3/dev is the
pass I wanted; widths come from the design lane's headless browser and land in the body as numbers.

Evidence convention, ruled for everyone: UI PRs put screenshots on the orphan branch `pr-assets`
(one directory per PR, files linked by SHA in the body), never in the tree and never on main. That
satisfies AGENTS.md's "never commit PR-only assets" — the tree never carries them — while keeping the
evidence attached to the repo rather than to a scratchpad. Adding it to CLAUDE.md's merge-gate section.
