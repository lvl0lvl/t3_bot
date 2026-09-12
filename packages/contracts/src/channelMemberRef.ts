/**
 * WHO IS ASKING, on the channel READ path. Derived from the caller's own
 * credential, never from a request field.
 *
 * A LEAF MODULE ON PURPOSE. Every layer that reads channels needs this type —
 * the MCP toolkit, the projection repository, the websocket shell stream, the
 * HTTP snapshot — and the alternative to one home is the shape being restated
 * at each of them. It was, briefly: a nominal class in the toolkit and a
 * structural interface in the persistence service, with only the second one
 * reachable from `ws.ts`. Two spellings of one identity is the drift this file
 * exists to end.
 *
 * It imports nothing but the operator id, which is why it can sit here without
 * dragging the server into `packages/contracts`.
 *
 * @module channelMemberRef
 */
import type { ThreadId } from "./baseSchemas.ts";
import { HUMAN_OPERATOR_MEMBER_ID } from "./orchestration.ts";

/**
 * NOT EXPORTED, and a class rather than a symbol brand.
 *
 * A `unique symbol` property stops an object LITERAL and not a SPREAD: a spread
 * copies the brand along with everything else, so
 * `{ ...someRealRef, memberId: "someone-else" }` typechecks — the exact mistake
 * the brand exists to stop, expressible by copying a legitimate ref and
 * changing one field. A PRIVATE field is the version a spread cannot carry,
 * because spreading an instance yields a plain object without it.
 *
 * `erasableSyntaxOnly` is why the fields are assigned in the body rather than
 * declared as parameter properties.
 */
class MemberRef {
  private readonly nominal!: void;
  readonly memberKind: "thread" | "human";
  readonly memberId: string;
  constructor(memberKind: "thread" | "human", memberId: string) {
    this.memberKind = memberKind;
    this.memberId = memberId;
  }
}

/**
 * The two fields `ChannelMember` carries and the decider's issuer uses, so this
 * is not a new vocabulary — but UNCONSTRUCTIBLE outside this module, which is a
 * type error rather than a convention.
 *
 * WHY IT IS NOMINAL AT ALL: the read path has no decider. A channel COMMAND
 * that arrives without an issuer is refused by the aggregate, so a gateway that
 * forgot one fails loudly. A channel READ has nothing equivalent — the ref is
 * simply a parameter where a caller's own thread used to be hardcoded, so
 * "read as someone else" is one argument away and nothing downstream would
 * notice. Making the value unconstructible is what stops a handler building one
 * out of a request payload, which is the only way that argument gets a
 * hostile value.
 *
 * An earlier version of this type asserted that property in prose over a plain
 * interface that its own tests built inline five times. Documenting a guard is
 * not having one, and three review lanes said so before it was fixed.
 */
export type ChannelMemberRef = MemberRef;

/**
 * The operator's own ref.
 *
 * REPLACES the `HUMAN_OPERATOR_CHANNEL_MEMBER` constant, and the difference is
 * the point rather than the spelling: a constant is a VALUE anyone can pass
 * anywhere, and it was passed straight into a membership filter from two call
 * sites. This is the same identity behind a function, so the day the operator
 * arrives on an authenticated session this becomes a function OF that session
 * and every caller keeps compiling. A payload field could never have satisfied
 * it, which is the bug this shape forecloses rather than documents.
 *
 * Single-operator today: every connection is this member, and that operator owns
 * the database. That is a fact about deployment, not a licence for the read path
 * to skip the filter.
 */
export const refFromOperatorSession = (): ChannelMemberRef =>
  new MemberRef("human", HUMAN_OPERATOR_MEMBER_ID);

/**
 * An agent thread's ref, from the thread id its credential carries.
 *
 * TAKES A BRANDED `ThreadId`, and that is the whole of what makes it safe to
 * live in a shared package. `refFromThreadCredential(input.memberId)` does not
 * compile: a tool payload's field is a plain string, and turning one into a
 * `ThreadId` needs `ThreadId.make` — which this repo forbids on anything from
 * outside the server, is visible in a diff, and greps in one line.
 *
 * THIS IS NOT `makeChannelMemberRef(kind, id)`, and the difference is not
 * cosmetic. A factory taking both fields from anywhere makes a handler passing
 * `payload.memberId` indistinguishable from one passing the session's. These
 * two constructors are named for their SOURCE, and typed so that taking the id
 * from a request is not expressible without visibly going around them. Nothing
 * here validates anything; the property is that the wrong thing is conspicuous.
 *
 * The comms gateway's `refFromMcpCredential` takes the invocation SCOPE rather
 * than an id and is the only caller the toolkit may use — one more turn of the
 * same screw, at the layer that has a credential to read.
 */
export const refFromThreadCredential = (threadId: ThreadId): ChannelMemberRef =>
  new MemberRef("thread", threadId);
