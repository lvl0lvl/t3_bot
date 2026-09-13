FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-1ez · pushed 147c3eb45 · I orphaned a SECOND sweep anchor one round after the first — extracting refKey moved the line member-refs-unique-refuses-two-kinds anchored on, NOT RUN, exit 3 · both had one cause: I changed code the config points at without checking the config, and both were caught by the sweep 4 minutes later only because exit 3 outranks 2 · built the one-second version, check_anchors_resolve.py, 12/12 resolve exactly once, runs before a push now · ASK: want it in scripts/ as a guard-sweep pre-flight that refuses before the baseline instead of reporting NOT RUN after it?
AT: 2026-09-12 22:04 EDT

**Pushed `147c3eb45`. I orphaned a second anchor, one round after the first, and the sweep caught it again.**

On `fb7087b47`:

```
member-refs-unique-refuses-two-kinds: NOT RUN — anchor not found
SWEEP_EXIT=3
```

Extracting `refKey` — which I did *because* seeding the map from `seated` and then walking `adding` built the key in two places — moved the line that row anchored on. The other eleven rows killed, baseline 701, CI green by SHA on that head. So the only thing wrong with `fb7087b47` was that one row went unmeasured.

**Both anchors I have broken in this PR have the same cause: I changed code the config points at without checking the config.**

```
round 1  `if (refs.has(ref)) {`                      my Map fix rewrote the check
round 2  `const ref = JSON.stringify([kind, id]);`   extracting refKey moved the line
```

Both were found by the sweep four minutes after the fact, and only because exit 3 outranks a survivor. If NOT RUN scored below 2 I would have shipped a config with a dark row twice today — and the row that went dark was the one pinning this PR's own guard both times. That is the #17 ruling paying for itself twice in one PR.

**So I built the one-second version of the check the sweep does at the end of four minutes.** `check_anchors_resolve.py` reads the config and, for every row, asserts its `find` resolves **exactly once** in the file it names — absent is NOT RUN, and more-than-once is worse, because the mutation lands somewhere the row was not written about and a presence check cannot say which occurrence it found. It runs before a push now, not after one:

```
12/12 anchors resolve exactly once
every row would be measured
```

It is in my scratchpad rather than the repo. **Say if you want it in `scripts/` as a step on the sweep itself** — my read is that it belongs inside `guard-sweep.ts` as a pre-flight that refuses before the baseline rather than reporting NOT RUN after it, which would have turned both of today's incidents from a four-minute discovery into an immediate refusal. That is `t3_bot-2ij`'s neighbourhood but not its content, so I have not filed it pending your call.

**Sweep and CI re-running on `147c3eb45`.** Everything else for #34 is done: the delta rule with its proving mutant, `uw9` widened with api34's P-table and the stored-vs-canonicalised warning for the old handle, and the body rewritten to the delta wording with both repair holes named and measured. "PR ready #34" follows the two runs.
