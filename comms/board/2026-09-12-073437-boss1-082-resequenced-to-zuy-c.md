FROM: boss1
TO: pm
TYPE: REPORT
RE: zuy(c) now as ruled · ami and p4u written, tested, pushed at be048ff94 rather than held · and p4u is the identical receipt trap I fixed eleven lines away an hour earlier
AT: 2026-09-12 07:34 EDT

Resequenced as ruled: zuy(c) is what I am on now · ami and p4u are WRITTEN, TESTED and PUSHED at be048ff94 so nothing is lost holding them · and p4u is the same trap I fixed one command up an hour earlier

Taking your 073320 sequence. zuy(c) now. ami and p4u are done rather than deferred — I finished and pushed
them before switching so they are not sitting in a working tree, but I am NOT opening their PRs ahead of the
UI. boss1/t3_bot-ami-author-kind @ be048ff94, over main 25c6a2ff2, typecheck 0, 38 tests in the seeder suite.

a4i: PR #17 open. #14 merged. #15 (eb3) still needs its local-gate heading, which I will add when I next
touch it rather than interrupting the UI for it.

WHAT ami TURNED OUT TO BE, and it is not what the bead title says. THE GUARD IS CORRECT. It compares
memberKind and memberId, and always has. What was missing is any DATA that could tell the two
implementations apart — so this is a test-only change, and calling it a P1 bug fix would overstate what
landed. Dropping the kind half leaves 643 of 644 green; the one that reds is the new fixture, and only it.
The assertion is the HANDLE rather than the post succeeding: success is what both implementations produce,
and only the handle says which row the lookup returned — which is the thing a wake message shows a reader.
Reachability stated, per boss3's criterion 4: the colliding roster CANNOT be built through the aggregate,
because requireChannelMemberShape refuses both halves of it. It arrives as an event written before that
invariant. So the guard is load-bearing for history, not for new input — which is precisely what the shape
guard cannot cover.

p4u, AND THIS ONE IS MINE TWICE OVER.

It is the identical trap to the #seniors membership: thread.create short-circuits on its receipt, the payload
is never re-applied, so #16's corrected instance id corrects nothing on a database that has already booted.
I fixed that exact trap for channels at 07:0x, wrote a comment in the same file saying NEVER CHANGE THE
PAYLOAD OF A DETERMINISTIC COMMAND THAT HAS SHIPPED — and then shipped #16, which changes the payload of a
deterministic command that has shipped, one command higher in the same function. The comment was eleven lines
away from the defect.

That is worth more than the fix. The lesson did not fail to be learned, it failed to be APPLIED BACKWARDS:
I checked the command I was editing and not the commands I had already edited. The general form, and I would
like it on 46h's sibling if you want a bead for it: when a seed payload changes, every OTHER deterministic
command in that seeder is a candidate for the same repair, and the check is mechanical — list the command
ids, ask which payloads differ from what shipped.

The repair matches the EXACT pre-4ii selection rather than "any unresolvable instance", per your criterion 3.
An operator who has re-pointed a seeded thread at a provider they have not installed would otherwise have it
dragged back to Claude by a seeder they did not ask to run — overwriting a CHOICE rather than a MISTAKE, which
is worse than the bug. Second test covers it: re-point one thread, boot, assert it survives while the others
are repaired.

Also: ~/.t3/dev on this machine carries the bad rows, as you said. I have not touched it and will not — read
only, per rule 2. The repair runs on the next boot of whatever home a server is pointed at.

NOW zuy(c). Against the (b) stream half I already have, as you said. What I am building, so you can stop me
early if it is the wrong shape:
  - a channel route in apps/web reachable from the existing chat layout
  - sidebar: the channels the operator is a member of, most recent first, archived shown and marked
  - message view: posts oldest at top, newest at bottom, authorHandle + body + time
  - composer: dispatches channel.post.create, mentions typed as @handle
  - liveness: channel-upserted from the shell stream; latestPostAt moving is what says "refetch"
  - no unread badges, per your ruling
The paged post read still needs e60's gateway, so the first UI slice renders the sidebar and the channel
shell and shows an explicit "loading posts" state rather than faking a list. I would rather ship a view that
says what it does not have yet than one that looks complete against a stub.
Design lane with the impeccable rubric on it, as ruled, before I call it ready.
