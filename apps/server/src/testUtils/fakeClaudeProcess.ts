// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off globalDateInEffect:off - process-table and child-process
// probes on Node's own timers: the callers run under `it.effect`'s TestClock, where an Effect timer would wait for
// time nobody advances, and the thing waited on is the OS process table, not the Clock.
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";

import * as Effect from "effect/Effect";

import { isHostWindows } from "@t3tools/shared/hostProcess";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

/**
 * The line every fake `claude` ends with. The real binary exits when its stdin
 * closes, and the SDK relies on that: `probeClaudeCapabilities` aborts the
 * query, which ends the child's stdin and awaits nothing — the SIGTERM
 * fallback lives in a parent-exit handler a terminated vitest worker never
 * runs. A fake that ignores the end of stdin outlives every test that spawned
 * it: 424 of them, 16 GB, were found on one machine (`t3_bot-4ra`).
 */
export const FAKE_CLAUDE_EXIT_ON_STDIN_END = 'lines.on("close", () => process.exit(0));';

/**
 * Spawns the fake the way the SDK does and closes its stdin at once. Resolves
 * with the exit code when the fake exits; rejects after `timeoutMs` naming the
 * child it had to kill. A plain Promise on Node's own timer, because the
 * callers run under `it.effect`'s TestClock where an Effect timeout would
 * wait for time nobody advances.
 */
export const assertFakeClaudeExitsOnStdinEnd = (
  executablePath: string,
  options: { readonly env?: NodeJS.ProcessEnv; readonly timeoutMs?: number } = {},
): Effect.Effect<number> =>
  Effect.promise(
    () =>
      new Promise<number>((resolve, reject) => {
        const child = NodeChildProcess.spawn(
          process.execPath,
          [executablePath, "--output-format", "stream-json", "--input-format", "stream-json"],
          { stdio: ["pipe", "pipe", "pipe"], env: options.env ?? process.env },
        );
        const timeoutMs = options.timeoutMs ?? 5_000;
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(
            new Error(
              `fake claude ${executablePath} (pid ${child.pid}) did not exit within ${timeoutMs} ms of its stdin closing`,
            ),
          );
        }, timeoutMs);
        child.once("exit", (code) => {
          clearTimeout(timer);
          resolve(code ?? -1);
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.stdin.end();
      }),
  );

/**
 * Fails if any child of THIS process still runs a fake whose executable lives
 * under `fixtureDirectory`. The SDK hands out no handle to the child it spawns,
 * so its exit is observable only in the process table; the wait is a bounded
 * real-time poll on Node's timer for the same TestClock reason as above, and
 * it ends the moment the table is clear. Children are matched by parent pid,
 * never by name alone, so another session's fakes do not count against this
 * test — and this test's survivors cannot hide behind them.
 *
 * THE WINDOW IS SHORT ON PURPOSE. After the abort the SDK arms an unref'd
 * five-second SIGKILL timer; a test that finishes leaves the worker with
 * nothing to keep it alive, so that timer never fires and the fake is
 * orphaned. A wait of five seconds or more keeps the worker alive until the
 * timer lands and reports a leak as clean (measured: the keepalive fake reads
 * as gone at 5.0 s). One second is longer than any honest exit on stdin end
 * and shorter than the timer.
 */
export const assertNoFakeClaudeChildren = (
  fixtureDirectory: string,
  timeoutMs = 1_000,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    // `ps` is not there; the callers skip on Windows the same way.
    if (yield* isHostWindows) return;
    yield* Effect.promise(() => awaitNoFakeClaudeChildren(fixtureDirectory, timeoutMs));
  });

const awaitNoFakeClaudeChildren = async (fixtureDirectory: string, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  let survivors = await fakeClaudeChildren(fixtureDirectory);
  while (survivors.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    survivors = await fakeClaudeChildren(fixtureDirectory);
  }
  if (survivors.length > 0) {
    throw new Error(
      `${survivors.length} fake claude child(ren) of pid ${process.pid} outlived the probe: ${survivors.join("; ")}`,
    );
  }
};

const fakeClaudeChildren = async (fixtureDirectory: string): Promise<ReadonlyArray<string>> => {
  const { stdout } = await execFile("ps", ["-axo", "pid=,ppid=,command="]);
  return stdout.split("\n").flatMap((line) => {
    const row = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return row !== null && row[2] === String(process.pid) && row[3]!.includes(fixtureDirectory)
      ? [`${row[1]} ${row[3]}`]
      : [];
  });
};
