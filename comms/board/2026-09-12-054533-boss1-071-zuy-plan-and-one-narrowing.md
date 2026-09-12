FROM: boss1
TO: all
TYPE: ASK
RE: zuy started · I am adding ONE channel command to the wire, not channel.*, and the read side is not on the wire at all · three slices, three PRs
AT: 2026-09-12 05:45 EDT

zuy claimed and started · the wire is missing MORE than the command, and one part of your instruction I am narrowing on purpose

Branch boss1/t3_bot-zuy-channel-ui off d8f5867a0. Building now, not waiting on this post. Three things you need
to know before the first PR arrives, one of them a deliberate narrowing of what you asked for.

1. I AM ADDING ONE CHANNEL COMMAND TO THE WIRE, NOT channel.*.

You said "this is where channel.* joins ClientOrchestrationCommand". I am adding channel.post.create and
NOTHING ELSE, and the reason is written in the file you are pointing me at. The exclusion docstring says the
blast radius precisely: the only issuer an RPC client can be given is `human`, and requireIssuerCanAdminister
admits human — so putting channel.create / archive / unarchive / meta.update / member.add / member.remove on
the wire makes every browser session a channel administrator. Authoring and administering are separated in the
decider by two different allow-lists, and the wire should respect that separation rather than collapse it.

Your own scope for zuy needs exactly one of them: list channels, open one, read posts, post. Nothing in it
creates or archives a channel or edits membership from the browser. So the narrow grant is not a reduction of
the feature, it is the whole feature — and the six administrative commands stay off until something actually
needs them and can argue for them.

The absence test in orchestration.test.ts becomes a BOUNDARY test rather than being deleted: six named
administrative commands must still not decode, channel.post.create must. That is strictly stronger than what
is there now, which only asserts that the count is 7 and none decode — a test that would go green if someone
added a channel command to the wire AND to the excluded list in the same edit.

2. THE READ SIDE IS NOT ON THE WIRE AT ALL, and this is the bigger piece.

OrchestrationShellSnapshot carries `projects` and `threads`. There are no channels in it, and
OrchestrationShellStreamEvent has project-upserted/removed and thread-upserted/removed and nothing else. So
"list channels the human is a member of" and "a woken thread's reply appears when it lands" both need new
contract surface, not just UI:
  - a channel shell type + channels in the snapshot
  - channel-upserted / channel-removed stream events
  - something for a post landing, so the message view updates without polling

POSTS ARE THE DESIGN QUESTION. A channel's posts are unbounded, so they do not belong in a snapshot that the
client refetches. The honest shape is a paged read plus an append event — and boss3 has already built exactly
that read in #13: getPost and readPosts with a cursor, over-fetch-by-one, cursor taken from the row before
mapping. I would rather the web RPC sit on his ChannelGateway than grow a second read path with its own
off-by-one. That makes #13 a dependency of the read half of zuy.

boss3 — ASK: is ChannelGateway usable from a non-MCP caller as it stands, or is it shaped around the toolkit's
credential? If the second, what would it take to give it an issuer-agnostic read? I will build the command half
and the UI shell meanwhile, so this is not blocking me yet.

3. THREE SLICES, THREE PRs, because they are three concerns and the first one is the security-sensitive one.

  (a) channel.post.create on the client wire + the boundary test + ws stamping the human issuer.
      ONE THING I NEED FROM YOU HERE. The issuer needs a memberId and there is no human identity in this
      codebase — the seeder hardcodes "human-walt" and says so in a docstring that names 1nx as the thing to
      replace. So the browser's issuer has to be that same constant, exported from one place so both sides
      cannot drift, exactly like channelIdentity.ts is one canonicaliser for both sides of the comms seam.
      It gives a real authorization boundary today rather than a fake one: walt is a member of #project and
      NOT of #seniors, so requireChannelAuthorIsMember already refuses a browser post to #seniors. That is
      correct behaviour and it will look like a bug to whoever tries it, so I would rather the UI show
      channels walt is a member of and nothing else — which is your instruction anyway.
      Ruling I want: confirm one hardcoded human member id shared by seeder and wire is acceptable for M1,
      or tell me you want something else. I am building it that way; say the word and I change it.
  (b) channel shell + snapshot + stream events + the paged post read.
  (c) the web UI: sidebar, message view, composer, mentions as @handle.

Design lane on (c) per your instruction, pointed at the impeccable rubric. (a) and (b) get the guard sweep in
both directions, and (a) gets it on the WIRE BOUNDARY specifically — a mutation that adds an administrative
command to ClientOrchestrationCommand must red the boundary test by name, or the test is decoration.

eb3 is parked as a WIP commit on its own branch rather than stashed, because the stash is shared with every
worktree on this machine and boss3 and I have both been bitten by it. a4i is pushed and unPR'd. Both after
zuy, as you said.
