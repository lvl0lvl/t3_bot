/**
 * Every command a client door dispatches, issued as the human operator.
 *
 * ONE STAMP, TWO THIN TRANSPORTS — the write-side twin of `readChannelPostPage`.
 * `issuer` is optional on the engine's dispatch options: the rule that a client
 * door must supply it lives in that option's docstring and in `requireCommandIssuer`,
 * which fails closed, and in no type. Measured before this module: ~50 dispatch call
 * sites in the server, four passing an issuer — the socket, HTTP, the seeder's
 * `SEED_ISSUER`, and the MCP door's `thread` issuer in
 * `mcp/toolkits/comms/channelGatewayLive.ts`. Once a door was wired without one:
 * `#14` widened `ClientOrchestrationCommand` and stamped the socket only, leaving the
 * HTTP twin passing nothing; review found it by executing the door, not by a test or
 * the compiler, and `#19` stamped it inline. Two doors with two inline stamps is the
 * call-site count that produced the defect; a door that dispatches THROUGH this
 * helper cannot forget.
 *
 * A DOOR THAT HANDS THE ENGINE SERVICE TO A HELPER is a door too. `ws.ts` provides
 * `OrchestrationEngineService` to `importRecentAgentThreads` (the
 * `agentSessionsImport` RPC: `thread.create`, `thread.history.import`) and to
 * `linkCreatedPullRequest` (the `gitRunStackedAction` RPC: `thread.pull-request.link`),
 * and with the raw engine both dispatched bare — no issuer, no origin, and no
 * `dispatch` at the door to see; the absence sat at a `provideService`. What those
 * RPCs provide now is `withClientDispatch`: the same service with its `dispatch`
 * replaced by the door's bound one, so a helper cannot dispatch as anyone but the
 * connection's operator. The input that breaks a raw hand-off: the first of those
 * commands to grow an issuer invariant, refused inside the helper with nothing at
 * the door to point at.
 *
 * THE STAMP IS UNCONDITIONAL. `requireCommandIssuer` ignores the field for every
 * command that has no issuer invariant, so stamping only channel commands would make
 * this the helper that remembers for the commands someone thought of. The stamped
 * operator can post because the seeder seats the same id in every channel's
 * membership — so `requireChannelAuthorIsMember` decides against a member that
 * exists.
 *
 * @module clientDispatch
 */
import { operatorCommandIssuer, type OrchestrationClientOrigin } from "@t3tools/contracts";

import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine.ts";

/**
 * A door's dispatch: the command alone. The options are this module's to fill.
 */
export type ClientDispatch = (
  command: Parameters<OrchestrationEngineShape["dispatch"]>[0],
) => ReturnType<OrchestrationEngineShape["dispatch"]>;

/**
 * Bind a door's engine and origin once; every command through the result carries
 * the operator issuer.
 *
 * `origin` is the door's to decide: the socket knows its connection's surface and
 * app version and passes them when either is set, HTTP passes nothing. The key is
 * left out rather than set to `undefined` because the options type is
 * `origin?: OrchestrationClientOrigin` under `exactOptionalPropertyTypes` — the engine
 * itself reads `options?.origin` and treats the two the same.
 */
export const makeClientDispatch = (
  engine: Pick<OrchestrationEngineShape, "dispatch">,
  origin?: OrchestrationClientOrigin,
): ClientDispatch => {
  const issuer = operatorCommandIssuer();
  return (command) =>
    engine.dispatch(command, {
      ...(origin === undefined ? {} : { origin }),
      issuer,
    });
};

/**
 * The engine as a door hands it to a helper: every member the helper could reach,
 * with `dispatch` replaced by the door's bound one.
 *
 * NOT A SPREAD. `streamDomainEvents` is a getter that opens a fresh subscription on
 * every access (`Layers/OrchestrationEngine.ts`); `{ ...engine }` would read it
 * once at the hand-off and every consumer of the copy would share that one
 * subscription. Members are named one by one so that a member added to the shape
 * fails here at `tsc` rather than reaching a helper as `undefined`.
 */
export const withClientDispatch = (
  engine: OrchestrationEngineShape,
  dispatch: ClientDispatch,
): OrchestrationEngineShape => ({
  readEvents: engine.readEvents,
  readThreadEvents: engine.readThreadEvents,
  getThreadReplayStats: engine.getThreadReplayStats,
  dispatch,
  subscribeDomainEvents: engine.subscribeDomainEvents,
  get streamDomainEvents() {
    return engine.streamDomainEvents;
  },
  latestSequence: engine.latestSequence,
});
