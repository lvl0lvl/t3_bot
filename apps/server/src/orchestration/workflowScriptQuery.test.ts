// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterAll, assert, describe } from "vite-plus/test";
import { symlinksSupported } from "@t3tools/shared/testing/symlinks";
import { readWorkflowScript } from "./workflowScriptQuery.ts";

// Per-process directories: two runs of this file sharing one fixture dir had
// one run's `afterAll` delete the other's inputs mid-test, and `symlinkSync`
// failing with EEXIST at load. The root must stay under the real projects
// root because `scriptsRoot()` is hard-wired to it and containment needs it.
const projectsRoot = NodePath.join(NodeOS.homedir(), ".claude", "projects");
NodeFS.mkdirSync(projectsRoot, { recursive: true });
const root = NodeFS.mkdtempSync(NodePath.join(projectsRoot, "__wf_script_test__-"));
const outsideDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "wf-outside-"));
const scriptPath = NodePath.join(root, "run.js");
NodeFS.writeFileSync(scriptPath, "export const meta = {};\n");
// A non-js file that EXISTS, under the root. A name that is never created
// fails on realpath with "not-found" whether or not the extension gate is
// there, so it cannot tell the gate from its absence (`t3_bot-jaq`).
const nonJsPath = NodePath.join(root, "run.ts");
NodeFS.writeFileSync(nonJsPath, "export const meta = {};\n");
const outside = NodePath.join(outsideDir, "wf-outside.js");
NodeFS.writeFileSync(outside, "evil\n");
const link = NodePath.join(root, "sneaky.js");
// A `.js` name INSIDE the root that resolves to the non-js file: the request
// passes the extension check on the requested path and containment, so only
// the extension check on the RESOLVED path can refuse it. A sweep found that
// check deletable with every test green (`t3_bot-jaq`) — no fixture reached it.
const disguised = NodePath.join(root, "disguised.js");
// Planted only where the host allows it; the escape test is skipped
// otherwise rather than passing vacuously on "not-found".
if (symlinksSupported) {
  NodeFS.symlinkSync(outside, link);
  if (!NodeFS.lstatSync(link).isSymbolicLink()) {
    throw new Error("test setup: sneaky.js must be a symlink");
  }
  NodeFS.symlinkSync(nonJsPath, disguised);
  if (!NodeFS.lstatSync(disguised).isSymbolicLink()) {
    throw new Error("test setup: disguised.js must be a symlink");
  }
}

afterAll(() => {
  NodeFS.rmSync(root, { recursive: true, force: true });
  NodeFS.rmSync(outsideDir, { recursive: true, force: true });
});

describe("readWorkflowScript containment", () => {
  effectIt.effect("serves a real script under the projects root", () =>
    Effect.gen(function* () {
      const result = yield* readWorkflowScript({ scriptPath });
      assert.include(result.contents, "export const meta");
      assert.equal(result.truncated, false);
    }),
  );

  effectIt.effect("rejects relative and non-js paths before touching the filesystem", () =>
    Effect.gen(function* () {
      // By REASON, not by `Exit._tag === "Failure"`: six reasons and a defect
      // all read as Failure, so that assertion held with the extension half of
      // the gate deleted — the file was never created, realpath said
      // "not-found", and the test was green over a gate that was not there.
      // `Effect.flip` also lets a defect fail the test instead of counting as
      // a refusal.
      const relative = yield* readWorkflowScript({ scriptPath: "run.js" }).pipe(Effect.flip);
      assert.equal(relative.reason, "invalid-path");
      // The file exists and is under the root, so the only thing that can
      // refuse it as "invalid-path" is the extension check on the REQUEST.
      // With that half deleted the request reaches realpath and the later
      // check on the resolved path refuses it as "not-js" instead — a
      // different reason, and a filesystem probe that should never have run.
      const nonJs = yield* readWorkflowScript({ scriptPath: nonJsPath }).pipe(Effect.flip);
      assert.equal(nonJs.reason, "invalid-path");
    }),
  );

  // Needs no symlink, so it runs on every host: a host that skips the symlink
  // test would otherwise have nothing pinning containment.
  effectIt.effect("rejects a real file outside the root", () =>
    Effect.gen(function* () {
      const escaped = yield* readWorkflowScript({ scriptPath: outside }).pipe(Effect.flip);
      assert.equal(escaped.reason, "outside-root");
    }),
  );

  effectIt.effect.skipIf(!symlinksSupported)(
    "rejects paths outside the root and symlink escapes",
    () =>
      Effect.gen(function* () {
        // A symlink INSIDE the root pointing outside must fail specifically on
        // realpath re-containment — a "not-found" would mean the link was
        // never exercised and the assertion proves nothing.
        const sneaky = yield* Effect.exit(
          readWorkflowScript({ scriptPath: link }).pipe(
            Effect.flip,
            Effect.map((error) => error.reason),
          ),
        );
        assert.equal(sneaky._tag, "Success");
        if (sneaky._tag === "Success") {
          assert.equal(sneaky.value, "outside-root");
        }
        // A `.js` link to a non-js file inside the root: contained, so the
        // resolved-path extension check is the only refusal left. Drop it and
        // the `.ts` is served.
        const disguisedResult = yield* readWorkflowScript({ scriptPath: disguised }).pipe(
          Effect.flip,
        );
        assert.equal(disguisedResult.reason, "not-js");
      }),
  );
});
