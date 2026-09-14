import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  EnvironmentAuthInvalidError,
  EnvironmentCommandRefusedError,
  EnvironmentInternalError,
  EnvironmentOperationForbiddenError,
  EnvironmentRequestInvalidError,
  EnvironmentResourceNotFoundError,
  EnvironmentScopeRequiredError,
} from "./environmentHttp.ts";

const traceId = "trace-1";

describe("environment HTTP errors", () => {
  // A client squashes the cause and shows `message`; an empty one becomes a generic
  // "The environment request failed." that names nothing the reader can act on.
  it("each carries a message that names its reason", () => {
    const errors = [
      new EnvironmentRequestInvalidError({
        code: "invalid_request",
        reason: "invalid_command",
        traceId,
      }),
      new EnvironmentAuthInvalidError({
        code: "auth_invalid",
        reason: "missing_credential",
        traceId,
      }),
      new EnvironmentScopeRequiredError({
        code: "insufficient_scope",
        requiredScope: "orchestration:read",
        traceId,
      }),
      new EnvironmentOperationForbiddenError({
        code: "operation_forbidden",
        reason: "current_session_revoke_not_allowed",
        traceId,
      }),
      new EnvironmentResourceNotFoundError({
        code: "not_found",
        reason: "thread_not_found",
        traceId,
      }),
      new EnvironmentInternalError({
        code: "internal_error",
        reason: "orchestration_snapshot_failed",
        traceId,
      }),
    ] as const;
    const details = [
      "invalid_command",
      "missing_credential",
      "orchestration:read",
      "current_session_revoke_not_allowed",
      "thread_not_found",
      "orchestration_snapshot_failed",
    ];
    errors.forEach((error, index) => {
      expect(error.message).toContain(details[index]);
    });
  });
});

describe("EnvironmentCommandRefusedError on the wire", () => {
  const decode = Schema.decodeUnknownSync(EnvironmentCommandRefusedError);
  const wire = (refusal: unknown) => ({
    _tag: "EnvironmentCommandRefusedError",
    code: "command_refused",
    commandType: "channel.post.create",
    message: "Orchestration command invariant failed (channel.post.create): refused.",
    traceId,
    refusal,
  });

  it("decodes a tag this build knows", () => {
    expect(decode(wire({ _tag: "channel-archived" })).refusal).toEqual({
      _tag: "channel-archived",
    });
  });

  // The HTTP door has its own field and its own wrapper; a fix on the socket door alone
  // leaves this one closed. THE INPUT THAT BREAKS THIS: `Schema.optional` here, which
  // rejects the whole 409 body over a tag the client could not have acted on. The
  // fields beside the tag tell "refusal absent, body intact" from "body replaced": a
  // fallback that rebuilds the error from `message` alone loses `traceId` and
  // `commandType`.
  it("decodes a tag it does not know as an untagged refusal, message intact", () => {
    const error = decode(wire({ _tag: "unknown-to-this-build" }));
    expect(error.refusal).toBeUndefined();
    expect(error.message).toBe(
      "Orchestration command invariant failed (channel.post.create): refused.",
    );
    expect(error.traceId).toBe(traceId);
    expect(error.commandType).toBe("channel.post.create");
  });
});
