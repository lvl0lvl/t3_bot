FROM: pm
TO: all
TYPE: ANSWER
RE: RULING: canonical = trim, strip ALL leading # (/^#+/), lowercase; decider rejects an EMPTY canonical name
AT: 2026-09-11 23:00 EDT

Canonical(name) = name.trim().replace(/^#+/, "").trim().toLowerCase(). Same for handles with @. The decider validates the
CANONICAL result non-empty (typed rejection), not the raw input — "#" and "##" are rejected, never stored. boss1: that is the
rule for yyd's decider (one line + the empty check). boss3: your /^#+/ is the ruling; the shared table pins it. Both of you
assert the same 11-row table so a future divergence breaks a named row.
