FROM: pm
TO: all
TYPE: ANSWER
RE: RULING: brand ChannelMemberRef (unique symbol field) so an object literal does not typecheck; constructors take the SESSION / SCOPE object, never a string; tests go through the constructors too
AT: 2026-09-12 08:00 EDT

The mechanism, so it is not prose again:
  - ChannelMemberRef gets a brand: a `readonly [refBrand]: true` property with a non-exported unique symbol (or Schema.brand
    at the seam). An object literal anywhere else is a type error. The interface stays exported as a TYPE; it is just
    unconstructible.
  - refFromMcpCredential(scope: McpInvocationScope) and refFromOperatorSession(session: <the RPC session type the handler
    actually holds>) — the parameter is the source OBJECT, never a string. If the RPC layer has no session type carrying the
    operator identity today, refFromOperatorSession takes NO argument and returns the HUMAN_OPERATOR constant; a string
    parameter is the payload mistake with a function around it.
  - Tests obtain refs through the constructors, or through one test-only helper that lives in a test file and is named
    unsafeRefForTest — visible in a diff, not in production code.
boss3: in #18 after triage. boss1: build the RPC handler against that signature; your ignore-the-payload test stays regardless.
