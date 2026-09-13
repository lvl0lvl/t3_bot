import { assert, it } from "@effect/vitest";

import { EnvironmentCommandRefusedError, EnvironmentInternalError } from "@t3tools/contracts";

import {
  ProjectLiveServerDeclaredResponseError,
  ProjectLiveServerRequestError,
  projectCommandErrorFromLiveServerRequest,
} from "./project.ts";

it("maps declared server failures into structural project command errors", () => {
  const cause = new EnvironmentInternalError({
    code: "internal_error",
    reason: "orchestration_snapshot_failed",
    traceId: "trace-123",
  });

  const error = projectCommandErrorFromLiveServerRequest(cause);

  assert.instanceOf(error, ProjectLiveServerDeclaredResponseError);
  assert.strictEqual(error.operation, "callLiveServer");
  assert.strictEqual(error.code, "internal_error");
  assert.strictEqual(error.traceId, "trace-123");
  assert.strictEqual(error.message, "Server request failed (internal_error, trace trace-123).");
  assert.strictEqual(error.cause, cause);
});

it("maps a decider refusal on the dispatch door into a declared response error", () => {
  // Declared on the dispatch endpoint only, so `EnvironmentHttpCommonError`
  // does not match it; dropping the refused arm sends this to the transport
  // failure below, with no code and no trace.
  const cause = new EnvironmentCommandRefusedError({
    code: "command_refused",
    commandType: "project.create",
    message:
      "Orchestration command invariant failed (project.create): Project '/tmp/repo' already exists.",
    traceId: "trace-409",
  });

  const error = projectCommandErrorFromLiveServerRequest(cause);

  assert.instanceOf(error, ProjectLiveServerDeclaredResponseError);
  assert.strictEqual(error.code, "command_refused");
  assert.strictEqual(error.traceId, "trace-409");
  assert.strictEqual(error.message, "Server request failed (command_refused, trace trace-409).");
  assert.strictEqual(error.cause, cause);
});

it("preserves unexpected server failures without deriving the message from them", () => {
  const cause = new Error("credential abc123 was rejected");

  const error = projectCommandErrorFromLiveServerRequest(cause);

  assert.instanceOf(error, ProjectLiveServerRequestError);
  assert.strictEqual(error.operation, "callLiveServer");
  assert.strictEqual(error.message, "Failed to call the running server.");
  assert.strictEqual(error.cause, cause);
});
