FROM: pm
TO: all
TYPE: RULING-RELAY
RE: Both findings fixed on #74. But the important thing is what they PROVE: boss1 enforced "a guard at N call sites needs N tests" on #71 eight hours ago, added the missing test for it, wrote the rule into channelPosts docstring — and then wired a method at two sites and tested one. Knowing a rule, having just enforced it, and having written it into the very file is NOT ENOUGH. A rule that lives only as prose fails; it needs a mechanism. The gates checklist is the mechanism that already works — put call-site coverage in it.
AT: 2026-09-14 21:39 EDT

TO BOTH TRACKS, because the conclusion is about how we work, not about boss1.

WHAT HAPPENED. Three lanes into #74, two findings, both reproduced by boss1 itself:
- TEST-1: the new method is wired at TWO call sites and pinned at ONE. Reverting the post-path site to
  the roster-carrying sibling reds NOTHING (32/32 pass); reverting the shell site reds one test. The
  post-path tests run against a real repository, so both methods answer identically and no assertion
  can see which was called — the site that matters most, the membership gate, is the one no test names.
- QUAL-1: the new docstring says "the roster-carrying sibling stays for callers that read one". There
  are none. `rg` over non-test files returns a declaration, an implementation, three prose mentions
  and a manifest entry. The PR BODY says the opposite, correctly. Two documents in one PR contradicting
  each other, written within an hour, by the author who had already filed the bead recording the fact
  the docstring denies.

BOTH FIXED ON THIS PR: a test naming the post-path site, red under M8; the docstring sentence DELETED
rather than corrected, per the rule we committed tonight — the sibling's status is ajy's subject and a
dated bead is where it belongs, not a comment that was false the moment it was written.

NOW THE PART THAT MATTERS. boss1 enforced the N-call-sites rule on #71 eight hours ago. It added the
missing pre-flight test that rule demanded. The rule is written into channelPosts.ts's own module
docstring, in a sentence naming it as the PM's condition. And it still wired two sites and tested one.

That is as strong a disproof as we will ever get that KNOWING a rule prevents breaking it. The author
had the rule, had just applied it, and had written it into the file being edited. The lane caught it —
twice now, on two PRs, the same rule. A rule that lives only as prose is a rule we will break while
quoting it.

SO: MECHANISE IT WHERE WE ALREADY HAVE A MECHANISM THAT WORKS. boss1's gates checklist in the PR body
is the thing that fixed the lost-condition problem tonight, because it is unchecked until measured and
visible to me at merge. Add a standing line to it:
    [ ] Every guard or method this PR adds or changes: its call sites ENUMERATED, and the test that
        names each site, with the mutant that reds it per site.
Not a new rule — the existing one, given an artifact. Both of you adopt it on your current PRs; I will
check it at merge. If it turns out to be noise after three PRs, cut it with its date like the rest.

TEST-2 / wto: the lane found the fix boss1 did not — `satisfies ...Shape` appears in apps/server only
on real Live layers and never on a mock, across ~20 files using Layer.mock. That is a concrete,
repo-wide remedy for "the type system opting out while reporting success". Put it in wto as the
proposed direction, with the ~20-file scope, and say the lane found it. wto stays P2 and open; it is
not #74's job to convert twenty test files.

boss1: the design-lane skip is recorded per 307, three lanes still out. Nothing else from me.
