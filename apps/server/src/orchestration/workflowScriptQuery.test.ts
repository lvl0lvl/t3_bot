// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterAll, assert, describe } from "vite-plus/test";
import { symlinksSupported } from "@t3tools/shared/testing/symlinks";
import { readWorkflowScript } from "./workflowScriptQuery.ts";

// Repeated from workflowScriptQuery.ts, which does not export it.
const SCRIPT_BYTE_CAP = 256 * 1024;

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
// A non-js file that EXISTS, under the root, so "not-found" cannot stand in
// for "invalid-path" (`t3_bot-jaq`).
const nonJsPath = NodePath.join(root, "run.ts");
NodeFS.writeFileSync(nonJsPath, "export const meta = {};\n");
const outside = NodePath.join(outsideDir, "wf-outside.js");
NodeFS.writeFileSync(outside, "evil\n");
// A real `.js` under ~/.claude but outside projects/: this separates the
// root's DEFINITION from its checks. Widen `scriptsRoot()` to `~` and every
// tmpdir fixture is still refused, but this one is served.
const besideRoot = NodePath.join(
  NodeOS.homedir(),
  ".claude",
  `__wf_script_outside_${process.pid}.js`,
);
NodeFS.writeFileSync(besideRoot, "evil\n");
// A directory whose name has the projects root as a string prefix:
// `startsWith(root)` without the separator admits it.
const siblingDir = NodeFS.mkdtempSync(
  NodePath.join(NodeOS.homedir(), ".claude", "projects__wf_sibling__-"),
);
const prefixSibling = NodePath.join(siblingDir, "x.js");
NodeFS.writeFileSync(prefixSibling, "evil\n");
// A directory named like a script: it opens, and only fstat's isFile refuses
// it. Drop that check and the read fails with EISDIR as "read-failed".
const dirScript = NodePath.join(root, "dir.js");
NodeFS.mkdirSync(dirScript);
// Never created: the one input the file realpath's own catch refuses.
const missing = NodePath.join(root, "missing.js");
// One byte over the cap and exactly at it: `>` versus `>=` differ only here.
const big = NodePath.join(root, "big.js");
NodeFS.writeFileSync(big, Buffer.alloc(SCRIPT_BYTE_CAP + 1, "a"));
const exact = NodePath.join(root, "exact.js");
NodeFS.writeFileSync(exact, Buffer.alloc(SCRIPT_BYTE_CAP, "a"));
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
  NodeFS.rmSync(besideRoot, { force: true });
  NodeFS.rmSync(siblingDir, { recursive: true, force: true });
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
      // By REASON, not by `Exit._tag === "Failure"`: every reason and a defect
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

  effectIt.effect("rejects a script beside the projects root or in a prefix-sibling of it", () =>
    Effect.gen(function* () {
      const beside = yield* readWorkflowScript({ scriptPath: besideRoot }).pipe(Effect.flip);
      assert.equal(beside.reason, "outside-root");
      const sibling = yield* readWorkflowScript({ scriptPath: prefixSibling }).pipe(Effect.flip);
      assert.equal(sibling.reason, "outside-root");
    }),
  );

  effectIt.effect("refuses a directory as not-regular-file and a missing name as not-found", () =>
    Effect.gen(function* () {
      const dir = yield* readWorkflowScript({ scriptPath: dirScript }).pipe(Effect.flip);
      assert.equal(dir.reason, "not-regular-file");
      const gone = yield* readWorkflowScript({ scriptPath: missing }).pipe(Effect.flip);
      assert.equal(gone.reason, "not-found");
    }),
  );

  effectIt.effect("caps the read at the byte cap and marks only a script over it", () =>
    Effect.gen(function* () {
      const over = yield* readWorkflowScript({ scriptPath: big });
      assert.equal(over.truncated, true);
      assert.equal(over.contents.length, SCRIPT_BYTE_CAP);
      const at = yield* readWorkflowScript({ scriptPath: exact });
      assert.equal(at.truncated, false);
      assert.equal(at.contents.length, SCRIPT_BYTE_CAP);
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
