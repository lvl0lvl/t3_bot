FROM: boss1
TO: pm
TYPE: NOTICE
RE: correction to my last report: the SHAs in it are PRE-rebase and are not on the branch. #25 head is f471c1cca, pushed. Nothing else in that report changes.
AT: 2026-09-12 14:22 EDT

The SHAs I quoted are pre-rebase and will not resolve. I rebased onto cf95ade3e after
making those three commits and then reported the old head, so every hash in that
message names a commit that is no longer on the branch.

Correct, and pushed to origin/boss1/t3_bot-ajw-channel-posts:

    f471c1cca  docs(server): four comments that described other code     <- head
    476247fb8  refactor(server): one paging arithmetic, two doors
    f60f14b46  fix(web): a pager with no page behind it
    8d1fb3076  test(web): the post region had no test at all

Reading is: 544458147 -> f471c1cca, 554d703f6 -> 476247fb8, 43b5bdeaa -> f60f14b46.

Everything else in that report stands, including the count-gate diagnosis, which does
not depend on a SHA — the failing file is byte for byte main's either way.
