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
  options?: { readonly maxOutputBytes?: number },
): Effect.Effect<string, VcsError, VcsProcess.VcsProcess> {
  return Effect.gen(function* () {
    const process = yield* VcsProcess.VcsProcess;
    const result = yield* process.run({
      operation: "CheckpointStore.test.git",
      command: "git",
      cwd,
      args,
      timeoutMs: 10_000,
      ...(options?.maxOutputBytes !== undefined ? { maxOutputBytes: options.maxOutputBytes } : {}),
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
    // A global excludes file listing one of the fixture paths makes the file
    // ignored from setup, so a test about ignore rules measures the
    // developer's config instead of the capture.
    yield* git(cwd, ["config", "core.excludesFile", "/dev/null"]);
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
        const fileSystem = yield* FileSystem.FileSystem;
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const checkpointRef = captureRef("checkpoint-capture-untracked");
        yield* writeTextFile(NodePath.join(tmp, "untracked.txt"), "new\n");

        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef });

        const tree = yield* git(tmp, ["ls-tree", "--name-only", checkpointRef]);
        expect(tree.split("\n").sort()).toEqual(["README.md", "untracked.txt"]);
        expect(yield* git(tmp, ["ls-files", "-t"])).toBe("H README.md");
        // A capture that returns without removing its temp index leaves the
        // file beside the user's own index, under the git dir the next
        // capture reads.
        const gitDirEntries = yield* fileSystem.readDirectory(NodePath.join(tmp, ".git"));
        expect(gitDirEntries.filter((name) => name.startsWith("t3-checkpoint-index-"))).toEqual([]);
      }),
    );

    it.effect("does not record a force-staged ignored file", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const checkpointRef = captureRef("checkpoint-capture-force-staged");
        // `git add -f .env` puts the file in the live index and nowhere else. A
        // temp index that takes the live index's membership commits the secret
        // and the turn's diff ships it to every client; one seeded from HEAD
        // never held it.
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
        // keep editing it. HEAD still holds it. A temp index with the live
        // index's membership records a deletion instead of the edit.
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
        // A project rooted at a subdirectory of a repository. `add -A -- .`
        // only resolves the unmerged entries under it; a temp index carrying
        // the live index's unmerged entries outside it makes `write-tree`
        // refuse the whole capture for as long as the conflict lasts.
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
        // Paths outside `add -A -- .` are whatever the temp index was seeded
        // with. Seeded from the live index they would carry the staged content.
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

    it.effect("seeds from HEAD when the repository has no index file", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const fileSystem = yield* FileSystem.FileSystem;
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const checkpointRef = captureRef("checkpoint-capture-no-index");
        // `git clone --no-checkout` and `git worktree add --no-checkout` leave
        // a HEAD and no index file. Without the `read-tree HEAD` step the temp
        // index starts empty and `add -A` skips README.md as ignored.
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
        // Ignore rules never apply to a tracked path. An entry dropped from the
        // temp index becomes untracked, and `add -A` then skips it.
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

    // DISCLOSED: four of these five reach no guard the contract tests do not
    // already reach, because a temp index seeded by `read-tree HEAD` carries
    // no index flags and no stat cache, and nothing here lists it. The half
    // of the mechanism they exercise is `add -A` reading every file: dropping
    // `add -A` reds them exactly as it reds the tracked-edit tests above. The
    // fifth, the both-flags absent entry, also pins that `add -A` records a
    // removal -- the mutant `add -A -- .` to `add --ignore-removal -- .` reds
    // it alone (measured 2026-09-15, git 2.52.0). All five red a temp index
    // seeded by copying the live index (measured, same date), which is the
    // capture they are here to refuse (PR #73, record t3_bot-b2m), where each
    // of these inputs recorded stale content.
    describe("inputs a temp index seeded from the live index gets wrong", () => {
      it.effect("records a same-size edit made in the second the index was written", () =>
        Effect.gen(function* () {
          const tmp = yield* makeTmpDir();
          const fileSystem = yield* FileSystem.FileSystem;
          const checkpointStore = yield* CheckpointStore.CheckpointStore;
          const checkpointRef = captureRef("checkpoint-capture-racy");
          // README.md is committed, edited to the same size, and the file and
          // the index carry the same second: the stat cache cannot tell the
          // contents apart and only the racy-clean rule (entry mtime not older
          // than the index file's) makes git hash the file. A copied index is
          // dated at copy time, younger than the entry, and trusts "# test".
          // 2026-01-01T00:00:00Z, in the seconds `utimes` takes.
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
          // The flag tells `add -A` not to read the file. A temp index that
          // carries it records "# test".
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
          // Same as assume-unchanged for `add -A`, under the other bit.
          yield* git(tmp, ["update-index", "--skip-worktree", "README.md"]);
          yield* writeTextFile(NodePath.join(tmp, "README.md"), "# edited by the turn\n");

          yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef });

          expect(yield* git(tmp, ["show", `${checkpointRef}:README.md`])).toBe(
            "# edited by the turn",
          );
          expect(yield* git(tmp, ["ls-files", "-t"])).toBe("S README.md");
        }),
      );

      it.effect("records an absent entry carrying both index flags as deleted", () =>
        Effect.gen(function* () {
          const tmp = yield* makeTmpDir();
          yield* initRepoWithCommit(tmp);
          const fileSystem = yield* FileSystem.FileSystem;
          const checkpointStore = yield* CheckpointStore.CheckpointStore;
          const checkpointRef = captureRef("checkpoint-capture-both-flags-absent");
          // `git ls-files -v` prints an entry with both bits as `s`, not `S`: a
          // check keyed on the letter routes it wrong. A real sparse checkout
          // is unaffected either way; this is the manual `update-index
          // --skip-worktree` override, and the answer pinned is HEAD-seeding's.
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

      it.effect("records the edit to a flagged entry sorting past the process runner's cap", () =>
        Effect.gen(function* () {
          const tmp = yield* makeTmpDir();
          yield* initRepoWithCommit(tmp);
          const checkpointStore = yield* CheckpointStore.CheckpointStore;
          const checkpointRef = captureRef("checkpoint-capture-listing-cap");
          // The runner truncates a command's output at its default cap
          // without a marker, so a check that lists the index for flags sees
          // only the entries before the cut. The fixture is past the cap only
          // if the default read is cut before the flagged entry, which the
          // two reads below measure instead of assuming.
          const pad = "p".repeat(240);
          for (let index = 0; index < 4_200; index += 1) {
            yield* writeTextFile(
              NodePath.join(tmp, `pad-${String(index).padStart(4, "0")}-${pad}`),
              "\n",
            );
          }
          yield* writeTextFile(NodePath.join(tmp, "zz-last.txt"), "committed\n");
          yield* git(tmp, ["add", "."]);
          yield* git(tmp, ["commit", "-q", "-m", "pad the listing"]);
          yield* git(tmp, ["update-index", "--assume-unchanged", "zz-last.txt"]);
          yield* writeTextFile(NodePath.join(tmp, "zz-last.txt"), "edited by the turn\n");
          const uncapped = yield* git(tmp, ["ls-files", "-v", "-z"], {
            maxOutputBytes: 8_000_000,
          });
          const atDefaultCap = yield* git(tmp, ["ls-files", "-v", "-z"]);
          expect(uncapped.endsWith("h zz-last.txt\0")).toBe(true);
          expect(atDefaultCap.length).toBeLessThan(uncapped.length);
          expect(atDefaultCap.endsWith("h zz-last.txt\0")).toBe(false);

          yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef });

          expect(yield* git(tmp, ["show", `${checkpointRef}:zz-last.txt`])).toBe(
            "edited by the turn",
          );
        }),
      );
    });
  });
});
