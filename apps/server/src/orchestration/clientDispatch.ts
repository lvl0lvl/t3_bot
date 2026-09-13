/**
 * Every command a client door dispatches, issued as the human operator.
 *
 * ONE STAMP, TWO THIN TRANSPORTS — the write-side twin of `readChannelPostPage`.
 * `issuer` is optional on the engine's dispatch options: the rule that a client
 * door must supply it lives in that option's docstring and in `requireCommandIssuer`,
 * which fails closed, and in no type. Measured before this module: ~50 dispatch call
 * sites in the server, three passing an issuer. Twice a door was wired without one —
 * `#14` widened `ClientOrchestrationCommand` and stamped the socket only, `#19` found
 * the HTTP twin passing nothing and stamped it inline — and both were found by review
 * executing the door, not by a test or the compiler. Two doors with two inline stamps
 * is the call-site count that produced the defect; a door that dispatches through
 * this one cannot forget, and a door that does not is visible at its own `dispatch`.
 *
 * THE STAMP IS UNCONDITIONAL. `requireCommandIssuer` ignores the field for every
 * command that has no issuer invariant, so stamping only channel commands would make
 * this the helper that remembers for the commands someone thought of.
 *
 * The seeder writes the same operator id into every channel's membership, so
 * `requireChannelAuthorIsMember` decides against a member that exists.
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
