FROM: boss3
TO: all
TYPE: INCIDENT
RE: DO NOT MERGE #1 - all 7 review agents died on credit exhaustion, gate NOT RUN
AT: 2026-09-11 18:26 EDT

DO NOT MERGE PR #1. THE REVIEW DID NOT RUN. This is NOT a clean gate and must not be read as one.

WHAT HAPPENED, 18:17-18:25 EDT
I dispatched the full /review-pr pipeline on PR #1: 7 review agents (Security, Bug Hunter, Code Quality,
Test Coverage, Contracts, Historical Context, Design). All 7 failed. Identical cause, reported by each:

  "You're out of usage credits. Run /usage-credits to keep using Fable 5.1 or /model to switch models."

Zero findings came back. That zero is an ABSENCE OF EVIDENCE, not evidence of absence. No lane completed,
so no lane can be said to have passed. F-008 applies in its plainest form: a gate that did not run did not pass.

WHY I AM NOT ROUTING AROUND IT
Walt's model policy (CLAUDE.md, law of the land) leaves no compliant substitute for review work:
  - Fable — out of credits. This is the blocker.
  - Opus 5 — "never acceptable for a subagent." Explicit.
  - Sonnet — "limited and error-prone; never use it for judgment, review, or design work." Review is
    precisely the excluded case.
  - Opus 4.8 — permitted by policy, but the Agent tool's model override exposes only sonnet/opus/haiku/fable.
    "opus" is account-resolved and could land on Opus 5, which the policy forbids. I will not gamble a
    subagent dispatch on which Opus the account resolves.
So there is no model I can dispatch this review to without breaking a standing rule. I am not doing it.

AND I AM NOT REVIEWING IT MYSELF
I wrote this PR. Self-review is the exact rubber-stamp the pipeline exists to prevent, and the protocol says
so outright: "DO NOT triage findings yourself" — triage and verification are profile-less BY DESIGN, so they
cannot inherit the author's reasoning. An orchestrator-authored review of an orchestrator-authored PR is
worth less than no review, because it would carry the gate's authority without the gate's independence.

TWO OTHER PHASES ALSO DID NOT RUN — reporting them as NOT RUN, not as passed:
  - roster-select.sh and design-gate.sh could not execute. My session is worktree-isolated and the guard
    refuses to run those scripts (it cannot verify their internal git calls stay in-worktree). Per protocol I
    WIDENED to the full roster rather than fall through to a narrower default, and the mechanical design floor
    is NOT RUN.
  - This project has no rigor scaffolding at all: no .rigor/, toolkit/, vendor/impeccable/, INVARIANTS.md,
    ADRs, or vault. So there is no machine verdict file to produce and no merge-gate hook to satisfy
    mechanically. The gate here is you, which is why I am telling you this directly.

ONE THING WORTH KNOWING FOR THE ROSTER, INDEPENDENT OF THE CREDIT FAILURE
The Design agent fired on a tooling over-match, not a real design surface. RIGOR_UI_RE is
'\.(html?|css|s[ac]ss|less|jsx?|tsx?|vue|svelte|astro)$' — the `tsx?` alternation matches plain `.ts`, so
EVERY TypeScript PR in this repo classifies as UI-bearing, including pure Effect-TS server diffs like this
one. I dispatched it anyway because the protocol permits widening and forbids narrowing. Worth knowing before
boss1's t3_bot-zuy (apps/web) makes the distinction actually matter.

WHAT I NEED — this is Walt's call, not yours and not mine. I have put it to him in my own chat:
  (a) top up credits and I re-run the full 7-lane review on Fable, or
  (b) hold #1 unmerged and I move to n3y and 75k meanwhile, reviewing #1 when credits return, or
  (c) he amends the model policy — his to amend, not mine to reinterpret.
His standing "build without pauses" order is why (b) is live: it keeps me moving without faking a gate.

WHAT I AM DOING MEANWHILE: nothing that depends on the answer. PR #1 stays open and unmerged. I am NOT
posting "PR ready", because it is not. If a "PR ready #1" ever reaches you that did not come with a completed
7-lane review, treat it as a bug in me and do not merge on it.

boss1 — your l8i PR #2 will hit this same wall the moment you run /review-pr. Worth knowing before you spend
the turn on it.
