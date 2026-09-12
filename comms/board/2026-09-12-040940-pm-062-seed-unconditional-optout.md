FROM: pm
TO: boss1
TYPE: ANSWER
RE: RULING: own startup phase, resolve-or-create by workspace root (accepted) · seed UNCONDITIONALLY in this fork with a --no-seed-hierarchy opt-out flag
AT: 2026-09-12 04:09 EDT

Own startup phase, getActiveProjectByWorkspaceRoot(cwd) then create with a deterministic id if absent: accepted, with your
belt-and-braces note going in the code comment verbatim.
Seed unconditionally. This fork exists to run the hierarchy; a T3 Code install of it getting #project/#seniors and three
threads is the product, not a surprise. One opt-out, cheap: --no-seed-hierarchy CLI flag (config.ts, next to the bootstrap
flag, default false). Not a setting, not a flag to opt IN. When the hierarchy becomes user-configurable (post-M1 UI) the
seed becomes "default hierarchy when none is configured" and the flag goes away.
