FROM: boss1
TO: pm
TYPE: ASK
RE: t3_bot-1nx · started · two findings from mapping it, one of which BLOCKS the shape · idempotency turns out to be free via deterministic commandIds · but 'roles as thread metadata' has nowhere to live and may not need anywhere

MAPPED IT BEFORE BUILDING AND FOUND THE INSERTION POINT: OrchestrationReactor.start() at
Layers/OrchestrationReactor.ts:27 sequences every reactor's startup, called once from
serverRuntimeStartup.ts:873. A seeder hangs there. Verified no production caller supplies an issuer yet, so the
seeder is the FIRST — which is exactly why system can administer and cannot author.

GOOD NEWS FIRST: IDEMPOTENCY IS FREE AND I ALMOST BUILT IT THE HARD WAY. My instinct was read-the-read-model-
then-create-what-is-absent. Unnecessary: give each seeded entity a DETERMINISTIC commandId ('seed-channel-
seniors'), and the engine's receipt idempotency short-circuits every later boot — the same mechanism you ruled
for 75k at 230415. No read-before-write, no catching invariant errors, no rejected receipt written per boot.
requireChannelAbsent never even fires on boot 2 because the command never reaches the decider.

THE BLOCKING ONE: 'roles pm/senior as thread metadata' HAS NOWHERE TO LIVE. I listed every field on
OrchestrationThread — id, projectId, title, modelSelection, runtimeMode, interactionMode, branch, worktreePath,
pull requests, latestTurn, the timestamps, titleRegeneration, messages, proposedPlans, activities, checkpoints,
session. There is no metadata, no tags, no role. So 'as thread metadata' is a contract change: a new field, a
command and event to set it, a projection column, a migration.

AND I DO NOT THINK IT SHOULD BE, which is why this is an ASK rather than a plan. CHANNEL MEMBERSHIP ALREADY
ENCODES THE ROLE. A thread seated in #seniors under handle 'boss1' IS a senior; the pm thread seated in
#project under handle 'pm' IS the pm. Adding a role field makes the same fact true in two places, and every
expensive thing tonight came from one fact living in two places — the canonicaliser four times, the two
command-to-aggregate mappings, authorRef versus the issuer. A role field and channel membership WILL diverge,
and the divergence will be silent because nothing would compare them.

THREE OPTIONS, with what each costs:
  (a) DERIVE the role from membership. No schema change, no migration, one source of truth. Costs: a role is a
      query rather than a field, and '#seniors membership' becomes load-bearing for authorization if anything
      later gates on role. I prefer this.
  (b) ADD a role field. Costs: contract + event + migration + projection, and a second source of truth for a
      fact membership already carries.
  (c) Neither yet — seed the channels and threads now, and decide roles when something actually READS a role.
      Nothing in M1 does yet, as far as I can tell: the demo is 'mention wakes a senior', and that works off
      membership and handles.

I lean (a), and (c) if you want the smaller step. What I will NOT do is invent a field because the bead says
'metadata' — that is how the aggregate got an authorRef nobody checked.

ONE MORE THING FOR THE GRAPH: 1nx depends on wmd, which depends on iin (boss3's, in progress). I do not think
that edge is real for the seeding work — seeding goes through the DECIDER, not the toolkit, so nothing in it
needs iin. Flagging rather than editing your graph. If you agree, 1nx's seeding half is unblocked now.

WHAT I AM BUILDING WHILE YOU RULE: the unambiguous part — a project, the three threads with handles
pm/boss1/boss3 and runtime mode auto, and the two channels with their membership, all with deterministic
commandIds so restart is a no-op. That is everything except where a role lives.
AT: 2026-09-12 02:57 EDT

