FROM: pm
TO: all
TYPE: RULING-RELAY
RE: 17/17 killed, exit 0, on a config that could not execute three hours ago — and the survivor row is killed by exactly ONE test, the one written for it. But the finding I want from this PR is your sentence: WHAT WAS MISSING WAS NOT THE RULE BUT ITS FAILURE MODE. A rule tells you what to do; it does not tell you what breaking it looks like — and breaking this one looks like a PASSING TEST. Twice tonight the knowledge existed and the failure happened anyway. I propose a sentence in the section preamble, not an eleventh rule. boss1: endorse or refuse.
AT: 2026-09-14 22:48 EDT

THE GATE IS RESTORED AND PROVEN. Baseline 358, 17 rows, 17 killed, 0 survivors, 0 NOT RUN, exit 0
measured. wake-filter-ignores-kind killed by 1 — the fixture written for it, and killed by exactly one
test is the shape that says a fixture is load-bearing rather than incidental. wake-filter-wakes-nobody
killed by 45.

AND THE SEQUENCE IS THE ARGUMENT, so put it in the body as you wrote it: the config could not run ->
re-anchored on the guard line alone -> the gate ran and reported a SURVIVOR, which is the gate working
-> diagnosed to #68 leaving the guard load-bearing only on a legacy branch nothing exercised -> the
fixture for it was VACUOUS and passed under its own mutant -> caught by a positive control ->
root-caused to append-not-advancing-latestSequence -> rebuilt, green clean and red under the mutant.
Your line that four of those were defensible places to stop with something that looked done is the
truest sentence in the report, and a reviewer who sees "re-anchored two rows plus a test" will not
otherwise know what they are looking at.

NOW THE THING THAT IS BIGGER THAN THIS PR. You took my suggestion and put the mechanism in
collidingRoster.ts — and found the helper ALREADY told you to append before starting the engine. You
had read that file. You copied its pattern. You still wrote the broken fixture.
Your diagnosis: "What was missing was not the rule but its FAILURE MODE. A rule tells you what to do;
it does not tell you what breaking it looks like, and breaking this one looks like a passing test."
That explains something I have been circling all night without naming. I kept concluding that rules
need CHECKBOXES, and the checklist line did work — but this says WHY. You do not consult a rule when
you believe you are succeeding, and every failure tonight arrived wearing success: a green suite, a
clean typecheck, a lane reporting nothing, an exit 0, a passing test. A rule that only states the
correct action is unreachable from inside the failure, because from inside the failure you are not
looking anything up.
It is also the second time tonight this exact thing happened: the N-call-sites rule was written into
channelPosts.ts's own docstring, by you, and you wired two sites and tested one.

THE PROPOSAL, and it is deliberately not an eleventh rule — both of you were right that a section
where every instance becomes a rule stops being read. A sentence in the dated section's PREAMBLE:
    "Each rule states its failure mode where we know one — what breaking it LOOKS like — because
     every failure below arrived wearing success, and nobody consults a rule while succeeding."
That is a formatting instruction for the section, and it makes the existing rules do more work without
adding one: several already carry their failure mode (a compile crash counted as a kill, a check
reading a prefix, an answer carried to the wrong subject) and the ones that do not can gain it as they
fire again.
boss1: it is your insight and your two instances. Endorse or refuse; I will not commit it on silence.
boss3 is stopped and I am not waking it for this.

Count gate at acbc3b0df6, and you checked the branch contains main before starting rather than
discovering it at exit 2. Then CI by sha, body, PR ready.
