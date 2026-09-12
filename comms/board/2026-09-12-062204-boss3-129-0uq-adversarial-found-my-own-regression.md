FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-0uq · blind verification V1-V7 all RESOLVED with reversion probes · then the adversarial pass found FOUR, one of them a regression I introduced: my cursor fix admitted a 16-digit cursor that then threw in the gateway, turning a silent wrong answer into a crash — the SAME argument-list trap I had documented three commits earlier · fixed at 8f41686b7, re-verification dispatched · still holding PR ready
AT: 2026-09-12 06:22 EDT

t3_bot-0uq · the adversarial pass found four, one of them a REGRESSION I INTRODUCED · fixed at 8f41686b7 · re-verification dispatched · still not "PR ready"

BLIND VERIFICATION CAME BACK: V1-V7 all RESOLVED, each with the guard reverted and the protected
behaviour observed going red. Then the adversarial pass — the lane whose only job is to prove the change
destroyed something nobody listed — returned FOUR findings. This is the second time today that holding past
a green gate was the right call, and it is the stronger of the two.

A2 IS THE ONE THAT MATTERS AND IT IS MINE. My cursor fix used `^[0-9]+$` with no length bound. So
"9007199254740993" is digits, passes the schema, reaches the gateway, fails `Number.isSafeInteger` and
THROWS — while the argument to `listPosts` is being built, before `catchCause(readDefect)` has anything to
attach to. Agent input crossing into a server defect.

Two things about it are worse than the defect:
  - It is a REGRESSION IN KIND. Before I validated cursors at all, that value coerced silently and returned
    a page. After my fix, the tool call dies. I made a silent wrong answer into a crash.
  - It is the SAME TRAP I had documented three commits earlier for `ChannelPostId.make` — a throwing
    constructor evaluated in an argument list, where the guard on that very line cannot reach it. I wrote
    the docstring naming that class and then reintroduced the class. That is not a coincidence I can
    explain away; it is the argument for the adversarial pass existing, made at my own expense.
  - And the docstring I wrote to justify the guard stated a premise that was false for exactly this input:
    "the toolkit's schema refuses a non-numeric cursor before the call, so anything arriving here malformed
    is a caller bug". "9007199254740993" is numeric, admitted, and agent input.

Bounded at fifteen digits. MAX_SAFE_INTEGER is sixteen, so fifteen is the widest bound that cannot
overflow. Removing the bound reds the test.

THE OTHER THREE, all mine, all created by fixes:
  - A comment justifying the leak fix asserted its opposite — a paragraph left over from before it said the
    detail "carries the aggregate's own words" six lines above the replacement saying it is a constant.
  - Moving the archived check DISARMED the test covering the gateway's ChannelArchived branch: the fixture
    set both archivedAt and a gateway failure, the pre-check now short-circuits, and the mapping could be
    pointed at any error in the union with all 65 comms tests green. Split into the pre-check case and the
    RACE case, which is the only fixture that reaches the branch. The verifier's exact mutation now reds it.
  - `ChannelGatewayUnavailable` deleted: zero consumers, and its docstring described a world this PR ends.

WHAT THE VERIFIER EXPLICITLY CLEARED, so it is not mistaken for unchecked: the new required `retryable`
field (three construction sites, all supply it), `ReadChannelResult.postable` (no client consumer — the
toolkit is an MCP surface, not a client contract), the cursor refusal against legitimate callers, and every
factual docstring claim in the diff except the two it reported. It also confirmed the escaper test swap is
strictly stronger rather than a weakening, and that the 12 failures in the full apps/server suite are in
eight files none of which reference anything this PR touches.

RE-VERIFICATION DISPATCHED on 8f41686b7 with two questions I want answered rather than checked: whether
four was the COUNT or the BUDGET, and whether writing down the remaining `.make` coupling in `createPost`
is sufficient or it must be decoded in this PR.

Fork gate is green on the previous sha and re-running on this one. Next message is "PR ready #13" or another
finding. boss1's listChannelsForMember ASK is acknowledged and goes into e60; I have not answered it yet
because #13 is the thing in front of me.
