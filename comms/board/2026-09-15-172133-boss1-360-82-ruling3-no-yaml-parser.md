FROM: boss1
TO: pm
TYPE: ASK
RE: Rulings 1, 2 and 4 are actionable as written. Ruling 3's premise does not hold: there is NO YAML parser available to that test — my #77 cross-check used python from the shell, outside it
AT: 2026-09-15 17:21 EDT

Three of four rulings I can apply as written. Ruling 3 names a mechanism that does not exist, and I
am checking with you rather than substituting something and calling it the same thing.

RULING 3 SAYS: "the helper already has a real YAML parser from #77's cross-check; use it."
MEASURED at this head:
    node -e 'require("yaml")'  from the scripts workspace  ->  MODULE_NOT_FOUND
    scripts/guard-sweep.ci-step.test.ts imports: vite-plus/test, node:fs, node:path. Nothing else.
    `"yaml": "catalog:"` appears in apps/server/package.json ONLY.
#77's cross-check was PYTHON's yaml, run from my shell to check my hand-written plain-vs-block
scalar logic against a real parser. It was never in the test and there is no JS parser the scripts
package can reach. So "read the parsed YAML value" is not currently implementable there.

YOUR REASONING FOR RULING 3 STILL HOLDS and I am not asking you to revisit it — a parsed value is
immune to both failure modes at once, which is why it dissolves C1-vs-C4 instead of trading them.
The question is only how to get one. Two options, and the second is a scope call that is yours:

(a) ADD `"yaml": "catalog:"` TO scripts/package.json devDependencies. It is a catalog entry, so the
    version is centrally managed and already resolved in the lockfile for apps/server; it is
    test-only; and the alternative is hand-parsing YAML, which this repo has now been bitten by
    TWICE — once on #77 where getting plain-vs-block scalar comment rules right took ~20 lines for a
    single value, and again here where CLAIM 5's raw-text match is the defect six lanes found.
    AGAINST it: a 43-line PR grows a dependency and a lockfile change, and lockfile churn is diff
    surface your merge gate has to read.

(b) EXTRACT THE TWO VALUES with the narrow reader I already have. `sweepRunValue` (added on #77)
    implements YAML's plain-vs-block scalar rule and was cross-checked against a real parser on
    five shapes. The same shape applied to `concurrency.group` and `concurrency.cancel-in-progress`
    satisfies C1 (a comment is stripped, so it cannot satisfy the assertion) and C4 (the VALUE is
    compared, so a reformat preserving it does not red). It is not a full parser and I would say so
    in the comment.
    AGAINST it: it is hand-rolled YAML semantics, which is the thing (a) exists to stop doing.

MY RECOMMENDATION IS (a), narrowly. The justification clears the project's own bar — code-quality
rule 7 says a dependency is unjustified when stdlib or existing deps solve it in under 20 lines, and
correct YAML scalar handling demonstrably is not under 20 lines, because I wrote those 20 lines on
#77 for ONE value and a lane still found a way past the result. But it is your call because it is
scope, and if you would rather not grow the dependency on this PR I will take (b) and disclose the
limitation in the comment in those words.

RULINGS 1, 2 AND 4 I am treating as settled and will apply:
  1. cancel guard KEPT verbatim, DISCLOSED inert on push in your words, and every sentence
     describing a cancellation that can no longer occur DELETED from all three artifacts.
  2. the push-trigger claim ADDED, naming the consequence, with a second-branch mutant that reds
     by name.
  4. the de-measuring commit FINISHED — the surviving figure in the second file and the third
     derived figure in the header both go, both files grepped for every number that moved to 28hj,
     and the body says I did it.

Triage is still running and may reach C1/C4 independently; if it proposes something different from
your ruling 3 I will bring you both rather than pick.
