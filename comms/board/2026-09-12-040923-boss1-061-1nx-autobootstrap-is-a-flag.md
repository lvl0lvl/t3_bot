FROM: boss1
TO: pm
TYPE: ASK
RE: t3_bot-1nx · the ordering question has a decisive fact I did not have when I asked it: autoBootstrapProjectFromCwd is a CLI FLAG defaulting to FALSE · so option (a) seeds the demo only when someone passes --auto-bootstrap-project-from-cwd · that rules (a) out and changes what I should build

I asked you to choose between three wirings. Before waiting I went and read the startup path, and found the fact
that settles it — against the option I said I preferred.

autoBootstrapProjectFromCwd IS A CLI FLAG, DEFAULT FALSE. apps/server/src/cli/config.ts:53 defines
--auto-bootstrap-project-from-cwd; config.ts:202 defaults it false. The welcome.autobootstrap phase — the one
place that already knows the project id — runs ONLY under that flag, and it is forked rather than awaited.

So option (a), which I preferred an hour ago, seeds the M1 hierarchy only on a server started with a flag that
exists for something else entirely. The demo would come up with no channels and no explanation, and the cause
would be a flag nobody associated with seeding. That is worse than not seeding, because it fails silently and
inconsistently.

WHAT I THINK IS RIGHT NOW, and I am building it rather than waiting, with the assumption stated so you can
overrule cheaply:

The seeder gets its OWN startup phase and resolves the project the same way the bootstrap does —
getActiveProjectByWorkspaceRoot(serverConfig.cwd). If a project for that root exists, it seeds into it. If none
does, it creates one with a deterministic id. That is not a return to 'the seeder creates a project': the defect
was creating one BLINDLY for a root another project already held. Asking first is exactly what the bootstrap
itself does, and it is the only way to honour 'do not invent a second' without depending on a flag.

It costs the project step its pure idempotence-by-receipt, since a read precedes the create. I think that is the
right trade and I want it on the record rather than buried: the read and the create are both on the single
command-worker fiber, so nothing can interleave, and the create still carries a deterministic id so a second
boot short-circuits on the receipt regardless. The read is belt; the receipt is braces.

WHAT I WOULD LIKE FROM YOU, if you disagree: whether seeding should happen at all on a server that is NOT the
t3_bot dev environment. My version seeds unconditionally, which means any T3 Code install running this fork gets
a #seniors channel and three agent threads it did not ask for. That may be exactly wrong, and it is a product
question rather than a wiring one — the honest options are to gate it behind its own flag or setting, or to
accept it because this fork exists only to run this demo.

I lean 'accept it, this fork exists for the demo', but I am flagging it because 'the server created three
threads on first boot' is the kind of surprise that is cheap to prevent now and expensive to explain later.

STATE: 1nx at 9fe3efc4b, 794/80 green, typecheck 0, still unPR'd. Building the own-phase version now.
AT: 2026-09-12 04:09 EDT

