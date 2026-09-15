// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ThreadId, type VcsError } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Scope from "effect/Scope";
import { describe, expect } from "vite-plus/test";

import { checkpointRefForThreadTurn } from "./Utils.ts";
import { parseTurnDiffFilesFromNumstat } from "./Diffs.ts";
import * as CheckpointStore from "./CheckpointStore.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as ServerConfig from "../config.ts";

const ServerConfigLayer = ServerConfig.ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-checkpoint-store-test-",
});
const VcsProcessTestLayer = VcsProcess.layer.pipe(Layer.provide(NodeServices.layer));
const VcsDriverTestLayer = VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcessTestLayer));
const CheckpointStoreTestLayer = CheckpointStore.layer.pipe(
  Layer.provideMerge(VcsDriverTestLayer),
  Layer.provideMerge(NodeServices.layer),
);
const TestLayer = CheckpointStoreTestLayer.pipe(
  Layer.provideMerge(VcsProcessTestLayer),
  Layer.provideMerge(VcsDriverTestLayer),
  Layer.provideMerge(ServerConfigLayer),
  Layer.provideMerge(NodeServices.layer),
);

function makeTmpDir(
  prefix = "checkpoint-store-test-",
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem | Scope.Scope> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.makeTempDirectoryScoped({ prefix });
  });
}

function writeTextFile(
  filePath: string,
  contents: string,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.writeFileString(filePath, contents);
  });
}

function git(
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<string, VcsError, VcsProcess.VcsProcess> {
  return Effect.gen(function* () {
    const process = yield* VcsProcess.VcsProcess;
    const result = yield* process.run({
      operation: "CheckpointStore.test.git",
      command: "git",
      cwd,
      args,
      timeoutMs: 10_000,
    });
    return result.stdout.trim();
  });
}

function initRepoWithCommit(
  cwd: string,
): Effect.Effect<
  void,
  VcsError | PlatformError.PlatformError,
  VcsProcess.VcsProcess | FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    yield* git(cwd, ["init"]);
    yield* git(cwd, ["config", "user.email", "test@test.com"]);
    yield* git(cwd, ["config", "user.name", "Test"]);
    yield* writeTextFile(NodePath.join(cwd, "README.md"), "# test\n");
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["commit", "-m", "initial commit"]);
  });
}

function buildLargeText(lineCount = 5_000): string {
  return Array.from({ length: lineCount }, (_, index) => `line ${String(index).padStart(5, "0")}`)
    .join("\n")
    .concat("\n");
}

it.layer(TestLayer)("CheckpointStore.layer", (it) => {
  describe("isGitRepository", () => {
    it.effect("returns false when no Git repository is detected", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        const checkpointStore = yield* CheckpointStore.CheckpointStore;

        expect(yield* checkpointStore.isGitRepository(tmp)).toBe(false);
      }),
    );

    it.effect("returns true when a Git repository is detected", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;

        expect(yield* checkpointStore.isGitRepository(tmp)).toBe(true);
      }),
    );
  });

  describe("diffCheckpoints", () => {
    it.effect("returns full oversized checkpoint diffs without truncation", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("thread-checkpoint-store");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: fromCheckpointRef,
        });
        yield* writeTextFile(NodePath.join(tmp, "README.md"), buildLargeText());
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: toCheckpointRef,
        });

        const diff = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: true,
        });

        expect(diff).toContain("diff --git");
        expect(diff).not.toContain("[truncated]");
        expect(diff).toContain("+line 04999");
      }),
    );

    it.effect("keeps a/ and b/ patch prefixes when the repository disables them", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        yield* git(tmp, ["config", "diff.noprefix", "true"]);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("thread-checkpoint-store-noprefix");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: fromCheckpointRef,
        });
        yield* writeTextFile(NodePath.join(tmp, "README.md"), "# changed\n");
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: toCheckpointRef,
        });

        const diff = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: false,
        });

        expect(diff).toContain("diff --git a/README.md b/README.md");
      }),
    );

    it.effect("can hide indentation churn when changes wrap existing lines", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("thread-checkpoint-store-whitespace");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

        const componentPath = NodePath.join(tmp, "Component.tsx");
        yield* writeTextFile(
          componentPath,
          [
            "export function View() {",
            "  return (",
            "    <section>",
            "      <h1>Title</h1>",
            "      <p>Body</p>",
            "    </section>",
            "  );",
            "}",
            "",
          ].join("\n"),
        );
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: fromCheckpointRef,
        });
        yield* writeTextFile(
          componentPath,
          [
            "export function View() {",
            "  return (",
            "    <section>",
            "      {isReady ? (",
            "        <div>",
            "          <h1>Title</h1>",
            "          <p>Body</p>",
            "        </div>",
            "      ) : null}",
            "    </section>",
            "  );",
            "}",
            "",
          ].join("\n"),
        );
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: toCheckpointRef,
        });

        const normalDiff = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: false,
        });
        const whitespaceIgnoredDiff = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: true,
        });

        expect(normalDiff).toContain("diff --git");
        expect(normalDiff).toContain("-      <h1>Title</h1>");
        expect(normalDiff).toContain("+          <h1>Title</h1>");
        expect(whitespaceIgnoredDiff).toContain("diff --git");
        expect(whitespaceIgnoredDiff).toContain("+      {isReady ? (");
        expect(whitespaceIgnoredDiff).toContain("+        <div>");
        expect(whitespaceIgnoredDiff).not.toContain("-      <h1>Title</h1>");
        expect(whitespaceIgnoredDiff).not.toContain("+          <h1>Title</h1>");

        for (const ignoreWhitespace of [false, true]) {
          const numstat = yield* checkpointStore.diffCheckpoints({
            cwd: tmp,
            fromCheckpointRef,
            toCheckpointRef,
            ignoreWhitespace,
            format: "numstat",
          });
          expect(parseTurnDiffFilesFromNumstat(numstat)).toEqual([
            {
              path: "Component.tsx",
              additions: ignoreWhitespace ? 4 : 6,
              deletions: ignoreWhitespace ? 0 : 2,
            },
          ]);
        }
      }),
    );
  });

  describe("checkpoint file summaries", () => {
    it.effect("counts changes whose full patch exceeds the output limit", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("large-checkpoint-summary");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
        const filePath = NodePath.join(tmp, "README.md");
        const lineCount = 20_000;
        yield* writeTextFile(filePath, `${"before".repeat(50)}\n`.repeat(lineCount));
        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef: fromCheckpointRef });
        yield* writeTextFile(filePath, `${"after".repeat(60)}\n`.repeat(lineCount));
        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef: toCheckpointRef });

        const numstat = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: false,
          format: "numstat",
        });

        expect(parseTurnDiffFilesFromNumstat(numstat)).toEqual([
          { path: "README.md", additions: lineCount, deletions: lineCount },
        ]);
        expect(numstat.length).toBeLessThan(100);
      }),
    );

    it.effect("preserves file paths and turn ranges without changing the user index", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        yield* git(tmp, ["config", "diff.renames", "copies"]);
        const fileSystem = yield* FileSystem.FileSystem;
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("checkpoint-summary-paths");
        const baseline = checkpointRefForThreadTurn(threadId, 0);
        const firstTurn = checkpointRefForThreadTurn(threadId, 1);
        const secondTurn = checkpointRefForThreadTurn(threadId, 2);
        const copiedText = Array.from({ length: 20 }, (_, index) => `copy line ${index}\n`).join(
          "",
        );
        const platform = yield* HostProcessPlatform;
        const renamedPath = platform === "win32" ? "renamed café.txt" : "renamed\tcafé\nname.txt";
        const addedPath = platform === "win32" ? "new café.txt" : "new\tfile\n名.txt";
        for (const [path, contents] of Object.entries({
          "copy-source.txt": copiedText,
          "deleted.txt": "delete me\n",
          "rename-old.txt": "before\nkeep one\nkeep two\nkeep three\n",
          "binary.bin": "\0before",
        })) {
          yield* writeTextFile(NodePath.join(tmp, path), contents);
        }
        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef: baseline });

        yield* fileSystem.rename(
          NodePath.join(tmp, "rename-old.txt"),
          NodePath.join(tmp, renamedPath),
        );
        yield* fileSystem.remove(NodePath.join(tmp, "deleted.txt"));
        for (const [path, contents] of Object.entries({
          "copy-source.txt": `${copiedText}one more\n`,
          "copied.txt": copiedText,
          [renamedPath]: "after\nkeep one\nkeep two\nkeep three\n",
          "binary.bin": "\0after",
          "empty.txt": "",
          [addedPath]: "first\nsecond\n",
        })) {
          yield* writeTextFile(NodePath.join(tmp, path), contents);
        }
        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef: firstTurn });
        const userIndex = yield* fileSystem.readFile(NodePath.join(tmp, ".git/index"));
        const input = {
          cwd: tmp,
          fromCheckpointRef: baseline,
          toCheckpointRef: firstTurn,
          ignoreWhitespace: false,
          format: "numstat" as const,
        };
        const firstSummary = parseTurnDiffFilesFromNumstat(
          yield* checkpointStore.diffCheckpoints(input),
        );
        const expectedFiles = [
          { path: "binary.bin", additions: 0, deletions: 0 },
          { path: "copied.txt", additions: 0, deletions: 0 },
          { path: "copy-source.txt", additions: 1, deletions: 0 },
          { path: "deleted.txt", additions: 0, deletions: 1 },
          { path: "empty.txt", additions: 0, deletions: 0 },
          { path: addedPath, additions: 2, deletions: 0 },
          { path: renamedPath, additions: 1, deletions: 1 },
        ].toSorted((left, right) => left.path.localeCompare(right.path));
        expect(firstSummary).toEqual(expectedFiles);

        yield* fileSystem.remove(NodePath.join(tmp, "empty.txt"));
        yield* writeTextFile(NodePath.join(tmp, "copy-source.txt"), "replacement\n");
        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef: secondTurn });
        const secondSummary = parseTurnDiffFilesFromNumstat(
          yield* checkpointStore.diffCheckpoints({
            ...input,
            fromCheckpointRef: firstTurn,
            toCheckpointRef: secondTurn,
          }),
        );
        expect(secondSummary).toEqual([
          { path: "copy-source.txt", additions: 1, deletions: 21 },
          { path: "empty.txt", additions: 0, deletions: 0 },
        ]);

        const inclusiveSummary = parseTurnDiffFilesFromNumstat(
          yield* checkpointStore.diffCheckpoints({ ...input, toCheckpointRef: secondTurn }),
        );
        expect(inclusiveSummary).toEqual(
          expectedFiles
            .filter((file) => file.path !== "empty.txt")
            .map((file) =>
              file.path === "copy-source.txt" ? { ...file, additions: 1, deletions: 20 } : file,
            ),
        );
        expect(
          yield* checkpointStore.diffCheckpoints({ ...input, toCheckpointRef: baseline }),
        ).toBe("");
        expect(yield* fileSystem.readFile(NodePath.join(tmp, ".git/index"))).toEqual(userIndex);
      }),
    );

    it.effect("uses HEAD for a missing baseline only when requested", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("checkpoint-summary-fallback");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
        yield* writeTextFile(NodePath.join(tmp, "README.md"), "changed\n");
        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef: toCheckpointRef });
        const input = {
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: false,
          format: "numstat" as const,
        };

        const error = yield* Effect.flip(checkpointStore.diffCheckpoints(input));
        expect(error._tag).toBe("VcsProcessExitError");
        const numstat = yield* checkpointStore.diffCheckpoints({
          ...input,
          fallbackFromToHead: true,
        });
        expect(parseTurnDiffFilesFromNumstat(numstat)).toEqual([
          { path: "README.md", additions: 1, deletions: 1 },
        ]);
      }),
    );
  });

  describe("captureCheckpoint", () => {
    const captureRef = (name: string) => checkpointRefForThreadTurn(ThreadId.make(name), 0);

    it.effect("records an untracked file and leaves the user index untouched", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const checkpointRef = captureRef("checkpoint-capture-untracked");
        yield* writeTextFile(NodePath.join(tmp, "untracked.txt"), "new\n");

        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef });

        const tree = yield* git(tmp, ["ls-tree", "--name-only", checkpointRef]);
        expect(tree.split("\n").sort()).toEqual(["README.md", "untracked.txt"]);
        expect(yield* git(tmp, ["ls-files", "-t"])).toBe("H README.md");
      }),
    );

    it.effect("records a same-size edit made in the second the index was written", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        const fileSystem = yield* FileSystem.FileSystem;
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const checkpointRef = captureRef("checkpoint-capture-racy");
        // README.md is committed, edited to the same size, and the file and the
        // index carry the same second: the stat cache cannot tell the contents
        // apart and only the racy-clean rule (entry mtime not older than the
        // index file's) makes git hash the file. A temp index stamped with the
        // copy time is younger than the entry and trusts "# test".
        // 2026-01-01T00:00:00Z, as the seconds `utimes` takes.
        const stamp = 1_767_225_600;
        yield* initRepoWithCommit(tmp);
        yield* fileSystem.utimes(NodePath.join(tmp, "README.md"), stamp, stamp);
        yield* git(tmp, ["add", "README.md"]);
        yield* fileSystem.utimes(NodePath.join(tmp, ".git", "index"), stamp, stamp);
        yield* writeTextFile(NodePath.join(tmp, "README.md"), "# tes2\n");
        yield* fileSystem.utimes(NodePath.join(tmp, "README.md"), stamp, stamp);

        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef });

        expect(yield* git(tmp, ["show", `${checkpointRef}:README.md`])).toBe("# tes2");
      }),
    );

    it.effect("records the working tree of an assume-unchanged file", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const checkpointRef = captureRef("checkpoint-capture-assume-unchanged");
        // The flag tells `add -A` not to read the file. The seeded index carries
        // it, so the capture must fall back to seeding from HEAD, which carries
        // no flags; trusting the flag records "# test".
        yield* git(tmp, ["update-index", "--assume-unchanged", "README.md"]);
        yield* writeTextFile(NodePath.join(tmp, "README.md"), "# edited by the turn\n");

        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef });

        expect(yield* git(tmp, ["show", `${checkpointRef}:README.md`])).toBe(
          "# edited by the turn",
        );
        expect(yield* git(tmp, ["ls-files", "-v"])).toBe("h README.md");
      }),
    );

    it.effect("records the working tree of a skip-worktree file the checkout does hold", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const checkpointRef = captureRef("checkpoint-capture-skip-worktree-present");
        yield* git(tmp, ["update-index", "--skip-worktree", "README.md"]);
        yield* writeTextFile(NodePath.join(tmp, "README.md"), "# edited by the turn\n");

        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef });

        expect(yield* git(tmp, ["show", `${checkpointRef}:README.md`])).toBe(
          "# edited by the turn",
        );
        expect(yield* git(tmp, ["ls-files", "-t"])).toBe("S README.md");
      }),
    );

    it.effect(
      "records an absent entry carrying both index flags as deleted, as seeding from HEAD does",
      () =>
        Effect.gen(function* () {
          const tmp = yield* makeTmpDir();
          yield* initRepoWithCommit(tmp);
          const fileSystem = yield* FileSystem.FileSystem;
          const checkpointStore = yield* CheckpointStore.CheckpointStore;
          const checkpointRef = captureRef("checkpoint-capture-both-flags-absent");
          // `git ls-files -v` prints an entry with both bits as `s`, not `S`: a
          // check keyed on the letter routes it wrong. Any tag but `H` falls back.
          // A real sparse checkout is unaffected either way; this is the manual
          // `update-index --skip-worktree` override, and it keeps main's answer.
          yield* git(tmp, ["update-index", "--skip-worktree", "README.md"]);
          yield* git(tmp, ["update-index", "--assume-unchanged", "README.md"]);
          yield* fileSystem.remove(NodePath.join(tmp, "README.md"));
          yield* writeTextFile(NodePath.join(tmp, "kept.txt"), "kept\n");
          expect(yield* git(tmp, ["ls-files", "-v"])).toBe("s README.md");

          yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef });

          expect(yield* git(tmp, ["ls-tree", "--name-only", checkpointRef])).toBe("kept.txt");
          expect(yield* git(tmp, ["ls-files", "-v"])).toBe("s README.md");
        }),
    );

    it.effect("does not record a force-staged ignored file", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const checkpointRef = captureRef("checkpoint-capture-force-staged");
        // `git add -f .env` puts the file in the live index and nowhere else: a
        // temp index that keeps the live index's membership commits the secret
        // and the turn's diff ships it. Seeding from HEAD never held it.
        yield* writeTextFile(NodePath.join(tmp, ".gitignore"), ".env\n");
        yield* git(tmp, ["add", ".gitignore"]);
        yield* git(tmp, ["commit", "-m", "ignore .env"]);
        yield* writeTextFile(NodePath.join(tmp, ".env"), "AWS_SECRET_ACCESS_KEY=secret\n");
        yield* git(tmp, ["add", "-f", ".env"]);

        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef });

        const tree = yield* git(tmp, ["ls-tree", "--name-only", checkpointRef]);
        expect(tree.split("\n").sort()).toEqual([".gitignore", "README.md"]);
        expect(yield* git(tmp, ["ls-files", ".env"])).toBe(".env");
      }),
    );

    it.effect("records a tracked file removed from the index but kept on disk", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const checkpointRef = captureRef("checkpoint-capture-stop-tracking");
        // The stop-tracking idiom: `git rm --cached`, then ignore the path and
        // keep editing it. HEAD still holds it, so seeding from HEAD records the
        // edit; a temp index with the live index's membership records a deletion.
        yield* git(tmp, ["rm", "--cached", "README.md"]);
        yield* writeTextFile(NodePath.join(tmp, ".gitignore"), "README.md\n");
        yield* writeTextFile(NodePath.join(tmp, "README.md"), "# local only\n");

        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef });

        expect(yield* git(tmp, ["show", `${checkpointRef}:README.md`])).toBe("# local only");
      }),
    );

    it.effect("captures from a subdirectory while a merge conflict sits outside it", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        const fileSystem = yield* FileSystem.FileSystem;
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const checkpointRef = captureRef("checkpoint-capture-conflict-outside");
        // A project rooted at a subdirectory of a repository. `add -A -- .` only
        // resolves the unmerged entries under it; the ones a copied index carries
        // for paths outside it make `write-tree` refuse the whole capture.
        yield* initRepoWithCommit(tmp);
        yield* fileSystem.makeDirectory(NodePath.join(tmp, "proj"));
        yield* writeTextFile(NodePath.join(tmp, "proj", "p.txt"), "p\n");
        yield* writeTextFile(NodePath.join(tmp, "other.txt"), "base\n");
        yield* git(tmp, ["add", "."]);
        yield* git(tmp, ["commit", "-m", "layout"]);
        yield* git(tmp, ["checkout", "-q", "-b", "side"]);
        yield* writeTextFile(NodePath.join(tmp, "other.txt"), "side\n");
        yield* git(tmp, ["commit", "-am", "side"]);
        yield* git(tmp, ["checkout", "-q", "-"]);
        yield* writeTextFile(NodePath.join(tmp, "other.txt"), "main\n");
        yield* git(tmp, ["commit", "-am", "main"]);
        const merge = yield* git(tmp, ["merge", "side"]).pipe(Effect.option);
        expect(Option.isNone(merge)).toBe(true);
        expect(yield* git(tmp, ["ls-files", "-u", "--", "other.txt"])).not.toBe("");
        yield* writeTextFile(NodePath.join(tmp, "proj", "p.txt"), "edited\n");

        yield* checkpointStore.captureCheckpoint({
          cwd: NodePath.join(tmp, "proj"),
          checkpointRef,
        });

        expect(yield* git(tmp, ["show", `${checkpointRef}:proj/p.txt`])).toBe("edited");
      }),
    );

    it.effect("records HEAD's content for a staged edit outside the capture directory", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        const fileSystem = yield* FileSystem.FileSystem;
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const checkpointRef = captureRef("checkpoint-capture-staged-outside");
        // Paths outside `add -A -- .` are whatever the seed holds: HEAD's content,
        // as seeding from HEAD gave, not the live index's staged content.
        yield* initRepoWithCommit(tmp);
        yield* fileSystem.makeDirectory(NodePath.join(tmp, "proj"));
        yield* writeTextFile(NodePath.join(tmp, "proj", "p.txt"), "p\n");
        yield* git(tmp, ["add", "."]);
        yield* git(tmp, ["commit", "-m", "layout"]);
        yield* writeTextFile(NodePath.join(tmp, "README.md"), "# staged\n");
        yield* git(tmp, ["add", "README.md"]);
        yield* writeTextFile(NodePath.join(tmp, "README.md"), "# worktree\n");

        yield* checkpointStore.captureCheckpoint({
          cwd: NodePath.join(tmp, "proj"),
          checkpointRef,
        });

        expect(yield* git(tmp, ["show", `${checkpointRef}:README.md`])).toBe("# test");
      }),
    );

    it.effect("leaves the user's split index and its shared files alone", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const fileSystem = yield* FileSystem.FileSystem;
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        // A copied split index written by `add -A` creates a new sharedindex.*
        // in the user's git dir per capture, and with a short expiry deletes
        // the one the live index still references.
        yield* git(tmp, ["config", "core.splitIndex", "true"]);
        yield* git(tmp, ["config", "splitIndex.sharedIndexExpire", "now"]);
        yield* git(tmp, ["update-index", "--split-index"]);
        yield* writeTextFile(NodePath.join(tmp, "untracked.txt"), "new\n");
        const sharedIndexFiles = fileSystem
          .readDirectory(NodePath.join(tmp, ".git"))
          .pipe(
            Effect.map((names) => names.filter((name) => name.startsWith("sharedindex.")).sort()),
          );
        const before = yield* sharedIndexFiles;
        expect(before.length).toBe(1);

        for (const turn of [0, 1, 2]) {
          yield* checkpointStore.captureCheckpoint({
            cwd: tmp,
            checkpointRef: checkpointRefForThreadTurn(
              ThreadId.make("checkpoint-capture-split"),
              turn,
            ),
          });
        }

        expect(yield* sharedIndexFiles).toEqual(before);
        expect(yield* git(tmp, ["status", "--porcelain"])).toBe("?? untracked.txt");
      }),
    );

    it.effect("seeds from HEAD when the repository has no index file", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const fileSystem = yield* FileSystem.FileSystem;
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const checkpointRef = captureRef("checkpoint-capture-no-index");
        // `git clone --no-checkout` and `git worktree add --no-checkout` leave a
        // HEAD and no index file; HEAD's tracked entries must still be captured,
        // including a tracked file the ignore rules would keep `add -A` from adding.
        yield* writeTextFile(NodePath.join(tmp, ".gitignore"), "README.md\n");
        yield* git(tmp, ["add", "-f", ".gitignore"]);
        yield* git(tmp, ["commit", "-m", "ignore the readme"]);
        yield* fileSystem.remove(NodePath.join(tmp, ".git", "index"));

        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef });

        const tree = yield* git(tmp, ["ls-tree", "--name-only", checkpointRef]);
        expect(tree.split("\n").sort()).toEqual([".gitignore", "README.md"]);
      }),
    );

    it.effect("records a tracked file that .gitignore also matches", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const checkpointRef = captureRef("checkpoint-capture-tracked-ignored");
        // Ignore rules never apply to a tracked path; an entry dropped from the
        // temp index would become untracked, and `add -A` would then skip it.
        yield* writeTextFile(NodePath.join(tmp, "build.log"), "old\n");
        yield* git(tmp, ["add", "build.log"]);
        yield* writeTextFile(NodePath.join(tmp, ".gitignore"), "build.log\n");
        yield* git(tmp, ["add", ".gitignore"]);
        yield* git(tmp, ["commit", "-m", "track then ignore"]);
        yield* writeTextFile(NodePath.join(tmp, "build.log"), "edited\n");

        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef });

        expect(yield* git(tmp, ["show", `${checkpointRef}:build.log`])).toBe("edited");
      }),
    );
  });
});
