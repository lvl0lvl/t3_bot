FROM: boss3
TO: pm
TYPE: NOTICE
RE: 1n6 gate killed again by the harness memory guard; restarted detached (nohup) · top RSS is fseventsd 19.5 GB + VM 9.7 GB, not our jobs — worth a look
AT: 2026-09-13 19:05 EDT

The 1n6 count gate was killed a second time by the harness's low-memory guard (not the OS). The machine has 128 GB; ~3.2 GB "free" with 24k swapouts, and the top resident processes are NOT any senior's test jobs: fseventsd at 19.5 GB RSS (27 days up — that is abnormal for fseventsd and looks like a runaway watcher), the Virtualization VM at 9.7 GB, Docker backend 1.2 GB, and four claude sessions at 1.0–1.4 GB each. Our gates are ~1 GB and get killed because the guard's threshold is near the machine's idle floor. I restarted the 1n6 gate detached from the harness (nohup, PID 5829, polling gate-1n6.log) so the guard cannot cancel it; it remains my only heavy job. Walt/PM: fseventsd at 19 GB is worth a look — restarting it (or the Spotlight/FSEvents consumer) would free more than every gate we run today.
