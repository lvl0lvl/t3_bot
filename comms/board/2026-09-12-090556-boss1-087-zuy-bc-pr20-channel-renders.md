FROM: boss1
TO: pm
TYPE: REPORT
RE: zuy (b)+(c) · PR #20 at 99ff25ec3 · a channel RENDERS in a browser and posting from it wakes an agent · the defect: the sidebar was empty against a real server while every socket test passed, because a browser bootstraps its shell over HTTP and resumes by sequence — the door I had not wired was the one that decides · both doors now one function, each with its own test, and unwiring either reds only that half · 30 mutants dead · local gate in the body, 12+3 pre-existing by name vs a base worktree, counts went UP · flagging: when #18 lands, boss3's branded refFromOperatorSession() and my HUMAN_OPERATOR_CHANNEL_MEMBER are two ways to one value and one should become the other · /review-pr next
AT: 2026-09-12 09:05 EDT

t3_bot-zuy · (b)+(c) · PR #20 open at 99ff25ec3 on main 852baba35 · a channel renders in a browser,
as promised · /review-pr next, then "PR ready"

THE THING YOU ASKED FOR IS ON SCREEN. Two seeded channels in the sidebar, most-recently-posted first.
Click one, type, Enter: the post stores with author_handle "walt" DERIVED FROM THE ISSUER, mentions
["boss1"], the mentioned thread wakes, the header's last-post time moves, and the sidebar reorders.
Screenshots are in Walt's chat. Re-verified after rebasing onto your moved main.

THE DEFECT THAT MATTERED, and I want it on the record because it is the two-door class again and I
walked into it from the same side as #14. The sidebar was EMPTY against a real server while every
socket-side test passed. The snapshot had no channels field at all, and channel-upserted fires only
when a channel CHANGES — so two channels sitting still were invisible forever.

And the door I had not wired was the one that decides: A BROWSER BOOTSTRAPS ITS SHELL OVER HTTP and
then resumes the socket by afterSequence. The resume path sends events, not a snapshot, and there are
no events for channels that have not changed. Wiring only the websocket fixes nothing a user can see.
Both doors now go through one named function, each with its own test, and unwiring either reds ONLY
that door's test — which is the measurement, because a shared mutant would have hidden exactly the
half that was broken.

NOT WAITING ON e60 AFTER ALL, for the sidebar: listChannelsForMember was already on my branch, and the
operator's ref is ONE VALUE rather than one per caller, so the constant makes the right thing the only
easy thing. HUMAN_OPERATOR_CHANNEL_MEMBER sits in contracts beside the id it must agree with. The
PAGED POST READ still needs e60's gateway, so the message region says so in words rather than
rendering an empty list — an empty list is what a channel with no posts looks like, and a reader who
cannot tell them apart concludes the channel is quiet when it is unreadable.

ON YOUR 08:00 BRANDING RULING AND boss3's 432a8f5cf: refFromOperatorSession() is zero-argument and
branded on his branch; my constant is the same value by a different route. WHEN #18 MERGES THOSE ARE
TWO WAYS TO OBTAIN ONE VALUE AND ONE SHOULD BECOME THE OTHER — one line, and I would rather do it at
that merge than leave both and call it done. Flagging so it does not become the drift we both keep
writing docstrings about. I will take it whichever way you rule; my preference is his constructor
wins and my constant becomes its body.

TWO DEFECTS FOUND BY MEASUREMENT RATHER THAN BY READING, both mine:
- A LITERAL NUL BYTE IN MY OWN SOURCE. The React key over the channel list spelled the separator by
  hand and got U+0000 instead of the escape. It renders as a space, typechecks, and passes every
  test; git reported the file as BINARY, which is the only reason it surfaced — in a rebase diff
  stat. The key is now one exported function and its test asserts the produced string, because
  reading the source is exactly what cannot see this. It is the second time today the same keystroke
  did the same thing, in two files.
- TWO MOCKS OF ONE SERVICE in the router harness after the rebase, at two levels of the layer graph.
  The outer wins, so the inner one's override never reached the app. The suite reported it as a
  PARSE ERROR on a duplicate import, and thirteen failures hid behind a file that never ran — your
  852baba35 "a test count may not go down silently" caught it: 183 tests had quietly stopped running.

LOCAL GATE per your interim ruling, in the PR body. vp check 0, vpr typecheck 0. apps/server 4652
pass / 12 fail, packages 1791 pass / 0 fail, apps/web 4516 pass / 0 fail with 3 files failing to LOAD.
The 12 and the 3 are pre-existing, measured BY NAME against a separate worktree at 852baba35 with its
own frozen install — diff is empty. Counts went UP on both sides (server 4669 -> 4674, web 4509 ->
4516) and the server delta is localised to the two files I add tests to.

30 MUTANTS, 30 DEAD, each reding a named test: 7 over the atoms, 4 over the key, 7 over the mention
boundary, 6 over the two doors, 6 over the view logic. I discarded two mutants for measuring nothing —
one broke the module instead of the behaviour, and one would have been secretly IDENTICAL to the
original because of that NUL byte.

STATE: #20 open (zuy b+c). #17 (a4i) and #19 (http issuer) still open and needing /review-pr + a
local gate. ami+p4u pushed, one PR per bead next. Running /review-pr on #20 now.
