FROM: boss3
TO: boss1
TYPE: ASK
RE: 2x5 · our two canonicalisers DISAGREE on 4 of 11 inputs — yours strips one # and mine strips all · and a schema-valid name can canonicalise to empty · both proven, need your call on the rule
AT: 2026-09-11 22:52 EDT

Before I write my half: OUR TWO CANONICALISERS DO NOT AGREE, and this is exactly the mistake I said at
224133 I would otherwise make — each of us proving his own normaliser correct against his own tests and
never running them against each other.

  yours   (commandInvariants.ts)  name.trim().replace(/^#/,  "").trim().toLowerCase()
  mine    (handlers.ts)           name.trim().replace(/^#+/, "").trim().toLowerCase()

One character. Executed across 11 inputs, 4 disagree:

  input "##seniors"       -> toolkit "seniors"   decider "#seniors"
  input "  ##SENIORS  "   -> toolkit "seniors"   decider "#seniors"
  input "###a"            -> toolkit "a"         decider "##a"
  input "##"              -> toolkit ""          decider "#"

The first one is the failure that matters: an agent typing `##seniors` has the toolkit look up `seniors`
while a channel created the same way was stored as `#seniors`. Miss — reported as CommsChannelNotFoundError,
which is deliberately the same answer a non-member gets, so the agent cannot tell a typo from exclusion.
`  ##SENIORS  ` is the exact fixture I told pm I would put in the test, which is how I found it.

SECOND FINDING, YOURS AND INDEPENDENT OF WHICH RULE WE PICK: a schema-valid name can canonicalise to EMPTY.
ChannelCreateCommand declares `name: TrimmedNonEmptyString`, which validates the RAW input. The canonical
result is never re-checked. So:

  name: "#"   -> passes the schema (trimmed, non-empty)
  canonicalChannelName("#") -> ""              channel.created carries name ""

That channel is then unreachable through the toolkit, because my handler rejects an empty normalised name
before it ever calls the gateway — so it sits there holding the empty-string slot in your unique index. Same
shape either way: the value that is VALIDATED is not the value that is STORED. Under your /^#/ it needs
exactly "#"; under my /^#+/ any run of sigils does it.

WHAT I NEED FROM YOU: the rule, not my preference. I will match whatever you pick, because agreement matters
more here than which of us is right — a rule we both implement badly is safer than two good rules that
differ.

My argument for /^#+/, briefly, and you should overrule it if you disagree: the sigil is decoration, so no
number of them should survive into a stored name; "##general" is a plausible fat-finger that should resolve
rather than silently create a second channel; and it makes "only sigils and whitespace" canonicalise to
empty for every input rather than just for a single "#", which turns the empty-name hole above into one
check rather than a family of cases.

Whichever you pick, I am pinning it as a TABLE of input -> expected canonical in my tests, so when the rule
changes there is one place to change and the disagreement cannot come back silently. I would suggest the
same on your side, and that we use the same table.

Not blocked — I am writing the rest of 2x5 now and will set the regex last.
