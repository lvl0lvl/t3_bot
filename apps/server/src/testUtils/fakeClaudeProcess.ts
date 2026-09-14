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
 * closes and the SDK relies on that: a fake that ignores the end of its stdin
 * is orphaned by every test that spawned it — `assertNoFakeClaudeChildren`
 * below says how, and why its window is the width it is.
 */
export const FAKE_CLAUDE_EXIT_ON_STDIN_END = 'lines.on("close", () => process.exit(0));';

/**
 * Spawns the fake the way the SDK does and closes its stdin at once. Resolves
 * with the exit code when the fake exits; rejects after five seconds naming
 * the child it had to kill. A plain Promise on Node's own timer, because the
 * callers run under `it.effect`'s TestClock where an Effect timeout would
 * wait for time nobody advances.
 */
export const assertFakeClaudeExitsOnStdinEnd = (
  executablePath: string,
  options: { readonly env?: NodeJS.ProcessEnv } = {},
): Effect.Effect<number> =>
  Effect.promise(
    () =>
      new Promise<number>((resolve, reject) => {
        const child = NodeChildProcess.spawn(
          process.execPath,
          [executablePath, "--output-format", "stream-json", "--input-format", "stream-json"],
          { stdio: ["pipe", "pipe", "pipe"], env: options.env ?? process.env },
        );
        const timeoutMs = 5_000;
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
 * HOW THE FAKE LEAKS, AND WHY THE WINDOW IS 1 s. On abort the SDK
 * (`@anthropic-ai/claude-agent-sdk` 0.3.260, `ProcessTransport.close()` in
 * `sdk.mjs` — the `close()` that ends `processStdin`; `rg -n "DFe=" sdk.mjs`
 * lands on its constant) ends the child's stdin at once and awaits nothing.
 * If the child is still alive it arms an unref'd 2 000 ms timer that
 * SIGTERMs, whose callback arms an unref'd 5 000 ms SIGKILL; a separate
 * `process.on("exit")` handler SIGTERMs tracked children on a normal parent
 * exit. A finished test leaves the vitest worker nothing to keep it alive, so
 * none of that fires: a fake that ignored the end of its stdin is orphaned —
 * 424 of them, 16 GB, on one machine (`t3_bot-4ra`). THE INPUT THAT BLINDS
 * THIS CHECK is a window past the SDK's SIGTERM: it keeps the worker alive
 * until the signal lands and reads the leak as clean (measured with the
 * keepalive fake: 2.5 s passed at 2.1 s; 1.9 s and 1 s failed). A fixed fake
 * is gone ~20 ms after its stdin ends (measured), so 1 s sees every honest
 * exit and never the SDK's.
 */
export const assertNoFakeClaudeChildren = (fixtureDirectory: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    // `ps` is not there; the callers skip on Windows the same way.
    if (yield* isHostWindows) return;
    yield* Effect.promise(() => awaitNoFakeClaudeChildren(fixtureDirectory));
  });

/** Under the SDK's 2 s SIGTERM and over a fixed fake's ~20 ms; the docstring above says why. */
const SURVIVOR_WINDOW_MS = 1_000;

const awaitNoFakeClaudeChildren = async (fixtureDirectory: string) => {
  const deadline = Date.now() + SURVIVOR_WINDOW_MS;
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
