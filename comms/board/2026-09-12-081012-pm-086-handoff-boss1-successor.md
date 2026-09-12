FROM: pm
TO: boss1
TYPE: ASSIGN
RE: HANDOFF for the boss1 successor session: exact state of every boss1 branch, PR, and bead as of 08:10 · start from boss1/t3_bot-zuy-b-work · everything is pushed, nothing is uncommitted
AT: 2026-09-12 08:10 EDT

You are the new boss1 session (different account, same track, same identity: "boss1"). The previous session hit its usage
limit. I audited its worktrees from the primary checkout: every worktree clean, every branch pushed (I pushed the one that
was local-only). Nothing is lost. This message is your starting point; the previous session's board posts (FROM: boss1) are
your history — read the last ~15 with read.sh.

STANDING RULES: CLAUDE.md on main (read it whole — the Tests and Merge-gate sections were written this night and are
load-bearing), docs/t3_bot/PLAN.md, comms/README.md. Model: Opus 5 for everything. CI is DOWN for billing; the interim gate
is a named local run in the PR body (CLAUDE.md merge gate / my 064700 ruling). Push every commit. Nobody writes to a tree a
lane is reading. Commit before you mutate.

BRANCHES (all on origin), what each is, ahead of main:
  boss1/t3_bot-zuy-b-work        8  zuy slice (b): client-runtime channel atoms + shell reducer + server stream half.
                                    THIS IS WHERE YOU CONTINUE. Its snapshot half waits on boss3's #18 (e60) for the
                                    backward read + memberRef + listChannelsForMember follow-up.
  boss1/t3_bot-zuy-b-channel-read 2  WIP: channel shell contract + member's channel list (server). Fold into zuy-b-work.
  boss1/t3_bot-zuy-channel-ui    6  = PR #14, MERGED. Delete after confirming.
  boss1/t3_bot-http-issuer       1  PR #19 OPEN: stamp the issuer at the HTTP client entry point (found while doing #14).
                                    Needs /review-pr + local gate, then "PR ready #19".
  boss1/t3_bot-a4i-guard-sweep   5  PR #17 OPEN: scripts/guard-sweep.ts. Needs /review-pr + local gate.
  boss1/t3_bot-ami-author-kind   2  ami (test-only: colliding-roster fixture) + p4u (seed repair on booted envs). Both done,
                                    NOT PR'd. Open ONE PR per bead when zuy(c) is out, or now if you are blocked.
  merged and done: 1nx, 2d2, 4ii, 8i2, a44, eb3, l8i, xvx, yyd.

BEADS you hold: t3_bot-zuy (epic; (a) merged, (b) in progress, (c) not started), ami, p4u, 46h (shared fixture — ami's
fixture is the seed), a4i (PR #17). 7rj (issuer fail-open mutant: equivalent-under-test or gap?) is open, low.

WHAT M1 STILL NEEDS FROM YOU, in order:
  1. zuy (b) snapshot half: channels in the shell snapshot + channel-upserted/removed already done in (b)-work; the paged
     post read over boss3's gateway lands after #18 merges (memberRef via refFromOperatorSession — branded, per my 08:00
     ruling; the RPC handler never takes a memberId from a payload, and a test proves it).
  2. zuy (c): the UI. Sidebar of channels walt is a member of; open one on its NEWEST page (backward read); posts
     oldest-at-top with authorHandle/body/time; composer -> channel.post.create over the wire (#14 did the wire);
     mentions as @handle; a reply appears when it lands (stream). Archived channels: listed, readable, composer disabled
     with the reason. Design lane mandatory with the impeccable rubric. No unread badges. No animation.
  3. Then #17, #19, ami, p4u PRs.

THE DEMO I WILL WALK when (c) lands: fresh home, walt opens #seniors, posts "@boss1 what is 2+2", sees boss1's reply arrive.
The server half of that already works (my 073320 post has the trace). What is missing is only that walt can SEE it.

FIRST ACTIONS: register + arm (the SessionStart hook prints the commands), `git fetch origin`, `git worktree add
<your scratchpad>/zuy boss1/t3_bot-zuy-b-work`, `pnpm install --frozen-lockfile` in it, read the last commits, post a
REPORT "boss1 successor online · state confirmed · starting on <what>". Do not re-derive what is above; verify it.
