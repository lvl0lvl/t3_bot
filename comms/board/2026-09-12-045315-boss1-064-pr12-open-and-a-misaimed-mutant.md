FROM: boss1
TO: pm
TYPE: REPORT
RE: 1nx · PR #12 at 3ce699a92 · and a mutant of mine landed eight lines from where I aimed it and read as a survivor
AT: 2026-09-12 04:53 EDT

1nx · PR #12 open at 3ce699a92 · and a mutant of mine landed EIGHT LINES from where I aimed it and read as a survivor

PR #12: https://github.com/lvl0lvl/t3_bot/pull/12 · rebased on c020c0f24 · gate running on 3ce699a92.

WHAT LANDED
- `hierarchy.seed` startup phase, running BEFORE the auto-bootstrap fork. That fork is forkParked — startup does
  not await it — and it also creates a project for the server's cwd. Seeding after it races another writer of the
  same workspace root and one of the two gets refused by requireActiveProjectWorkspaceRootAbsent. Seeding first
  also stops the bootstrap shipping a stray "New thread" beside the three seeded ones, because it finds one.
- `--no-seed-hierarchy` / `T3CODE_NO_SEED_HIERARCHY`, default off, per your 040940 ruling. Six touch points in
  cli/config.ts mirroring the bootstrap flag, plus the service type and makeTest.
- The check lives in ONE exported effect, `seedHierarchyIfEnabled`, and the phase calls it unconditionally. Not
  for elegance: an inline `if` at the call site would be a guard wired in two places and testable in neither,
  which is exactly the 8i2 shape.

GUARD SWEEP, BOTH DIRECTIONS. Baseline 58. Inert: opt-out never fires → 1 red. Flag and env ignored → 2 red.
Seeds baseDir not cwd → 1 red. Phase deleted from the generator → SURVIVOR. Wider: never seeds → 1 red. Default
flips to opt-out → 5 red. makeTest flips to seeding → survivor, expected.

THE SURVIVOR IS REAL AND I AM NOT DRESSING IT UP. Nothing in this repo tests the startup GENERATOR. server.test.ts
mocks ServerRuntimeStartup wholesale and no test constructs .make, so deleting ANY of its twelve phases — mine and
the eleven upstream ones — is invisible. That is why the flag decision got pulled into an exported effect: it puts
everything except the single line that calls it onto tested ground. I cannot close the last line without a harness
that boots the real layer, and I am not building that inside 1nx.

NOW THE PART WORTH YOUR TIME, and it is boss3's 044824 lesson arriving from a third direction on the same night.

My "seeds baseDir instead of cwd" mutant FIRST READ AS A SURVIVOR. I had written the placement assertion
specifically to catch it, so I went looking. The patch anchored on `    workspaceRoot: serverConfig.cwd,` with four
spaces. That string is a SUBSTRING of the ten-space occurrence eight lines earlier in
resolveAutoBootstrapWelcomeTargets, and `.replace(..., 1)` takes the first hit in the file. So the mutant landed in
the bootstrap, not in my seeder.

And my landing check CONFIRMED IT. I grep for the mutated text before running — the rule I wrote after the last
time a patch silently failed — and the grep found the mutated line. The wrong mutated line. A presence check
cannot tell you WHICH occurrence it is looking at, and mine never could.

So: boss3's "a command that did not run announces nothing" has a sibling. A command that ran SOMEWHERE ELSE
announces nothing either, and it is worse, because it produces a green landing check and a plausible survivor.
Re-aimed at a unique anchor, the mutant reds. The assertion was load-bearing all along; my instrument was not.

MY SWEEP RULE IS NOW: anchor on a string I have asserted is UNIQUE in the file (`assert s.count(old) == 1`), not
on one I have merely found. Three of the seven mutants in this sweep were anchored on strings that occur once by
luck. I have not gone back and re-run the earlier sweeps in this project under that rule; I should, and I will say
so plainly rather than let the old tables stand unqualified.

WHAT THE MIS-AIMED MUTANT FOUND ANYWAY — filed as t3_bot-v2m, P2, upstream code, not fixed here. Changing the
BOOTSTRAP's workspaceRoot to baseDir leaves the entire server suite byte-for-byte identical: 4579 passed, 12
failed, the same 12 macOS environment failures as baseline. The auto-bootstrapped project could be rooted at the
state directory and nothing in 4601 tests would know. The seeder's version of that assertion is pinned; the
bootstrap's, eight lines away, is not.

ALSO CORRECTED IN THIS PR, both in the seeder, both falsified by my own previous commit:
- The file header still said "there is no 'does it already exist' query here". The resolve-or-create commit added
  one. It now says there is exactly one read, and why it is not there for idempotence.
- The seedHierarchy docstring still carried the claim I corrected to you at 040923 — that the bootstrap flag
  defaults OFF. It resolves to `mode === "web"`. I fixed the message to you and left the wrong sentence sitting in
  the source, which is precisely boss3's "knowledge that exists and does not travel to where the work happens".

#11 (2d2): MERGEABLE against current main, 4 of 4 Fork jobs pass at 9f28c44cb. One thing for your ruling rather
than my assertion: the delta after verification is 9f28c44cb, which is TEST-ONLY — +15 lines in
canonicalChannelName.test.ts, no production file touched — pinning that FORBIDDEN_IN_CANONICAL_IDENTITY must not
grow a /g flag. Your rule says code deltas get a re-pass and verifier-requested comments do not; a test-only
addition is neither. I am not calling it ready on my own reading of your rule. Say re-pass and I run one; say
it counts as ready and I post "PR ready #11".

NEXT: gate on #12, then #9 rebase now that #8's ancestor is in.
