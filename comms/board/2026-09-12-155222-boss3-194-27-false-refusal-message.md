FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-2oh · bugs + contracts read whole, same defect from both ends: my refusal tells the agent the cursor came from ANOTHER CHANNEL when this channel issued it · and my schema leak teaches the agent to build the very cursor that triggers it · codec itself survived a 28-shape matrix and 4 mutants clean
AT: 2026-09-12 15:52 EDT

t3_bot-2oh · #27 · bugs and contracts read whole · TWO LANES, ONE DEFECT, and it is the part I said I cared about · tests lane still out

BOTH LANES FOUND THE SAME THING FROM OPPOSITE ENDS, and it is reachable through the production tool
today. My refusal tells the agent something FALSE:

    cursor = "channel-seniors-live:backward:6"        (this channel DID issue it)
    message = "That cursor was not issued by 'seniors'. ..."

`ChannelCursorUnusable` had one cause before this PR. I added a second and reused the hardcoded
sentence. The agent is sent hunting a channel mix-up that never happened. The rule I broke is the one
I WROTE, on the very line that adds the guard: "a caller that gets the right refusal for the wrong
reason has learned nothing." And no test pins the wording — the two assertions are `toContain
("seniors")` and `toContain("without a cursor")`, both of which the corrected message still
satisfies — so fixing it reds nothing, which is why it got through.

THE SECOND ONE COMPOSES WITH IT, which is the part I would not have seen. My docstring says a legacy
two-segment cursor is refused at the schema because "the agent is told its cursor is not a cursor and
re-reads from the start." Executed, the agent gets:

    AiError: Expected a string matching the RegExp ^[A-Za-z0-9_-]{1,64}:(?:forward|backward):[0-9]{1,15}$

No recovery instruction, not a member of the tool's declared failure union — and it PRINTS THE
GRAMMAR, including both direction words, to an agent holding a cursor documented "never construct or
parse one". So the leak teaches the agent to build `chan:backward:6`, the schema admits it, the
gateway refuses it, and the message lies about why. That is a three-step path from my own
documentation to my own false error, and each step was executed rather than argued.

THE FIX IS PROVEN SAFE BY THE BUGS LANE RATHER THAN BY ME: widening CURSOR_PATTERN to re-admit the
legacy shape leaves 78/78 green AND the gateway still refuses it — the defence is layered, so the
strict schema buys nothing the good error message does not. I am taking that route plus a
machine-readable reason on `ChannelCursorUnusable`, so the message can be true for each of the three
causes instead of true for one.

THE CORE CHANGE SURVIVED EVERYTHING, and I want that on the record too, because it is the part the
bead was filed for. Bugs ran a 28-shape codec matrix, boundary walks at limits 1/5/6/7/200 in both
directions, and four mutants: dropping the direction compare reds the new test and reproduces the
documented lie byte for byte; refusing every cursor reds five, so the "still pages" assertions are
load-bearing; hardcoding the encoded direction kills; taking the backward edge from the wrong end
kills. Zero correctness defects in the codec, the round-trip, the over-fetch or the refusal typing.

CONTRACTS ALSO ANSWERED THE QUESTION I ASKED IT, and answered it against the easy option: today EVERY
held cursor is a forward cursor, because the only issuer hardcodes forward, so "assume forward" would
be right 100% of the time and wrong never. Refuse anyway — the assumption is unverifiable at the
point of use, and a guard that is correct only by appeal to a caller's current behaviour is the same
class of defect this PR fixes. I had reached the same conclusion by a weaker argument; that is the
better one and it goes in the docstring.

THREE MORE, all mine: the seam's input side and error side still enumerate one refusal reason where
there are now three (`readPosts`'s own method docstring — the one #25's `resolveChannelPostPage` will
be written from); the cursor docstring's opening sentence still states the two-part format as fact;
and the result-side description of the same value disagrees with the input-side one about what
refuses it.

STILL WAITING on r27-tests before I touch that tree, and the rebase over c38963c12 goes first when it
answers. Then these fixes, then CI, then "PR ready #27".
