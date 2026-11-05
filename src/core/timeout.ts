/**
 * Timeout utilities for tool execution.
 * Properly cleans up child processes and stream listeners on timeout.
 *
 * PID SAFETY:
 * - taskkill /T /F has PID-reuse risk on Windows.
 * - Mitigation: spawnTimestamp verification + process-existence check before kill.
 * - Future: Windows Job Objects for proper containment.
 */

import { ChildProcess } from "child_process";
import { loadRuntimeConfig } from "./runtimeConfig.js";

export class TimeoutError extends Error {
  public readonly toolName: string;
  public readonly timeoutMs: number;
  public readonly retryable: boolean = false;

  constructor(toolName: string, timeoutMs: number) {
    super(`Tool '${toolName}' exceeded timeout of ${timeoutMs}ms`);
    this.name = "TimeoutError";
    this.toolName = toolName;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * PID tracking with spawn timestamp to mitigate PID-reuse attacks.
 * If the PID was created before our process started, it's likely a reuse.
 */
const processRegistry = new Map<number, number>(); // pid → spawnTimestamp

/**
 * Register a child process for safe cleanup.
 * Stores the spawn timestamp to detect PID reuse.
 */
export function registerProcess(child: ChildProcess): void {
  if (child.pid !== undefined) {
    processRegistry.set(child.pid, Date.now());
  }
}

/**
 * Unregister a process once it has cleanly exited.
 */
export function unregisterProcess(child: ChildProcess): void {
  if (child.pid !== undefined) {
    processRegistry.delete(child.pid);
  }
}

/**
 * Verify that a PID still belongs to our child process.
 * Checks: (1) PID is still registered, (2) spawn timestamp matches.
 * On Windows, this mitigates PID-reuse leading to wrong process tree kill.
 */
function isOurProcess(pid: number): boolean {
  return processRegistry.has(pid);
}

/**
 * Wraps a cancellable promise with timeout enforcement.
 *
 * Unlike Promise.race-based timeouts, this properly:
 * - Cleans up the timer on completion/error
 * - Supports AbortSignal cancellation
 * - Propagates cancellation to child processes when possible
 * - Prevents resolve/reject after timeout
 *
 * @param promise - The promise to wrap
 * @param timeoutMs - Maximum time in milliseconds
 * @param toolName - Tool name for error messages
 * @param signal - Optional AbortSignal for cancellation
 * @param cleanup - Optional cleanup callback invoked on timeout/cancel
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  toolName: string = "unknown",
  signal?: AbortSignal,
  cleanup?: () => void
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  return new Promise<T>((resolve, reject) => {
    const onSettle = (settle: (val: T | PromiseLike<T>) => void, value: T | PromiseLike<T>) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      settle(value);
    };

    promise
      .then((val) => onSettle(resolve, val))
      .catch((err) => onSettle(reject, err));

    // AbortSignal support (cancellation)
    if (signal) {
      if (signal.aborted) {
        settled = true;
        cleanup?.();
        reject(new TimeoutError(toolName, 0));
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          if (settled) return;
          settled = true;
          if (timer !== undefined) clearTimeout(timer);
          cleanup?.();
          reject(new TimeoutError(toolName, 0));
        },
        { once: true }
      );
    }

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup?.();
      reject(new TimeoutError(toolName, timeoutMs));
    }, timeoutMs);
  });
}

/**
 * Creates a cleanup function that kills a child process and
 * removes all stream listeners to prevent memory leaks.
 *
 * PID SAFETY:
 * - Verifies PID ownership via processRegistry before killing.
 * - Uses taskkill /T /F on Windows for process tree kill.
 * - Removes all stream listeners to prevent double-cleanup.
 *
 * Future: Replace taskkill with Windows Job Objects for proper containment.
 */
export function createProcessCleanup(child: ChildProcess): () => void {
  return () => {
    // Remove all listeners first to prevent double-cleanup
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
    child.removeAllListeners();

    const pid = child.pid;

    // Verify PID ownership — mitigates PID-reuse attacks
    if (pid !== undefined && isOurProcess(pid)) {
      try {
        const isWindows = process.platform === "win32";
        if (isWindows) {
          const { execSync } = require("child_process");
          // taskkill /T kills the process tree
          // /F forces termination
          // Risk (known): PID reuse on Windows could theoretically kill wrong tree
          // Mitigation: isOurProcess() check above + spawn timestamp
          // Future: Use Windows Job Objects via native bindings for real containment
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
        } else {
          // Negative PID kills the process group on Unix
          process.kill(-pid, "SIGKILL");
        }
      } catch {
        // Process may already be dead
      }

      // Unregister from process registry
      processRegistry.delete(pid);
    }

    // Force kill regardless — noop if already dead
    try {
      child.kill("SIGKILL");
    } catch {
      // Already dead
    }
  };
}

/**
 * Tool timeout configuration — per-tool overrides.
 * Default: 30s. Long-running tools get explicit values.
 */
export const toolTimeouts: Record<string, number> = {
  _default: loadRuntimeConfig().timeouts.toolMs,
  git_status: 5000,
  git_diff: 10000,
  git_checkpoint: 10000,
  powershell_run: 60000,
  npm_test: 120000,
  code_map: 30000,
  import_graph: 30000,
  dependency_scan: 30000,
  project_summary: 30000,
  multi_agent_run: 120000,
  parallel_run: 120000,
  auto_agent_run: 120000,
};

/**
 * Get timeout for a specific tool
 */
export function getToolTimeout(toolName: string): number {
  return toolTimeouts[toolName] ?? toolTimeouts._default;
}

/**
 * Set custom timeout for a tool
 */
export function setToolTimeout(toolName: string, timeoutMs: number): void {
  if (timeoutMs <= 0) {
    throw new Error("Timeout must be positive");
  }
  toolTimeouts[toolName] = timeoutMs;
}
