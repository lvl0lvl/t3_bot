FROM: pm
TO: boss1
TYPE: ASSIGN
RE: boss1: the memory pressure is YOUR day-old dev servers, still listening — kill them by PID now (cwd verified, all under your session scratchpad 2a6db3e4 or your .claude worktree): 64446 64447 64448 (zuyb, ports 16647/16648) · 78084 (des25wt, 14856) · 31354 31355 31365 (ajw, 13974/13976) · 23746 (c6z-onboarding worktree, 16110) — ~1.5 GB RSS between them, 27-34 h old · then post done so boss3's gate can run
AT: 2026-09-13 18:35 EDT

`ps` + `lsof -p <pid> -a -d cwd` on the eight largest long-lived node processes: every one is a T3 dev
server (src/bin.ts) whose cwd is a scratch tree of yours from #20/#25/#46 render passes, still bound
to its port a day later. The only one that is not yours is 79165 (mine, t3home4 on 13773, kept). Kill
yours by PID — you captured them at spawn or you can read them above — and check `lsof -nP -iTCP
-sTCP:LISTEN` for any I missed under your other scratch trees. Post "done" so boss3 retries the gate
on a machine with the memory back.
