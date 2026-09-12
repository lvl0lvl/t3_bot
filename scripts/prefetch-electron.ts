// @effect-diagnostics nodeBuiltinImport:off - an install hook that shells out and reads files.
/**
 * Fetch Electron's binary ONCE, at install, so test workers do not race for it.
 *
 * `electron@44` has no `postinstall` script — its `package.json` carries no
 * `scripts` block at all, so `allowBuilds: electron: true` in
 * `pnpm-workspace.yaml` allows a build that does not exist. Instead its own
 * `index.js` fetches the binary LAZILY: on the first `require("electron")`, if
 * `path.txt` is absent, it spawns `install.js` to download and unpack
 * `Electron.app`. In a fresh tree the first requirer is a vitest worker, and
 * vitest starts several: each sees no `path.txt`, each spawns `install.js`, and
 * they collide unpacking one directory —
 *
 *   Error: failed to create directory '…/electron/dist/Electron.app/Contents/MacOS': File exists
 *
 * — so whichever test file loses the race fails to LOAD. Measured on a cold tree
 * (`t3_bot-wjt`): `DesktopBackendConfiguration.test.ts` red on the first run,
 * 30/30 on the second, because by then one worker had won. The count gate hit
 * this on every base worktree and declared `@t3tools/desktop` unmeasurable
 * rather than guess at the cause.
 *
 * ONE SERIAL FETCH BEFORE ANYTHING REQUIRES ELECTRON is the whole fix, and
 * `prepare` is where every cold tree gets it: measured, it runs under
 * `pnpm install --frozen-lockfile` in this workspace, which is what the gate,
 * CI, and a developer's fresh worktree all run. Not a retry — a retry that
 * happens to win is the same race with better odds — and not `pnpm rebuild
 * electron`, which has nothing to rebuild.
 *
 * IDEMPOTENT: `path.txt` is what `install.js` writes last and what `index.js`
 * checks first, so its presence means the unpack completed. A second `prepare`
 * returns before doing anything.
 *
 * `install.js` is invoked bare. It reads no argv — measured, not assumed; the
 * `--no` in electron's own error message belongs to a different entry point —
 * so there is nothing to pass and a flag here would be decoration.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { createRequire } from "node:module";

// Resolved from the workspace root, which is where `prepare` runs. `electron`
// is a dependency of `apps/desktop`, so it resolves through that package
// rather than the root; a root-level resolve finds nothing and would report the
// fetch as done for a tree that has no electron at all.
const desktopPackageJson = NodePath.join(process.cwd(), "apps", "desktop", "package.json");
if (!NodeFS.existsSync(desktopPackageJson)) {
  process.stdout.write("prefetch-electron: no apps/desktop here, nothing to fetch\n");
  process.exit(0);
}
const desktopRequire = createRequire(desktopPackageJson);

let electronDir: string;
try {
  electronDir = NodePath.dirname(desktopRequire.resolve("electron/package.json"));
} catch {
  // A tree without electron installed has nothing to prefetch and must not
  // fail `prepare` over it — `prepare` runs for every install, including ones
  // that filter apps/desktop out.
  process.stdout.write("prefetch-electron: electron is not installed here, nothing to fetch\n");
  process.exit(0);
}

const pathFile = NodePath.join(electronDir, "path.txt");
if (NodeFS.existsSync(pathFile)) {
  process.stdout.write(`prefetch-electron: already fetched (${pathFile} exists)\n`);
  process.exit(0);
}

process.stdout.write("prefetch-electron: fetching Electron once, before any test worker can\n");
const result = NodeChildProcess.spawnSync(
  process.execPath,
  [NodePath.join(electronDir, "install.js")],
  { stdio: "inherit" },
);
if (result.status !== 0) {
  process.stderr.write(
    `prefetch-electron: install.js exited ${String(result.status)}; the first test run will ` +
      `race for the binary instead\n`,
  );
  process.exit(result.status ?? 1);
}
if (!NodeFS.existsSync(pathFile)) {
  process.stderr.write("prefetch-electron: install.js exited 0 but wrote no path.txt\n");
  process.exit(1);
}
process.stdout.write(`prefetch-electron: done (${NodeFS.readFileSync(pathFile, "utf8").trim()})\n`);
