import { spawn } from "child_process";
import { z } from "zod";
import { normalizeInput } from "../core/inputNormalizer.js";
import { ToolExecutionErrorClass, ErrorCode } from "../core/errorResponse.js";
import { loadRuntimeConfig } from "../core/runtimeConfig.js";
import { globalObservability } from "../core/observability.js";
import type { ToolExecutionContext } from "../core/executionContext.js";
import { globalBudgetEngine } from "../core/budgetEngine.js";
import { renderCommandForLog, resolveCommandSpec } from "../core/commandRunner.js";

export const runCommandSchema = z.object({
  command: z.string().optional(),
  commandId: z.string().optional(),
  timeout: z.number().min(1000).max(300000).optional(),
}).strict().refine(
  (data) => {
    const hasCommand = typeof data.command === "string" && data.command.length > 0;
    const hasCommandId = typeof data.commandId === "string" && data.commandId.length > 0;
    return (hasCommand && !hasCommandId) || (!hasCommand && hasCommandId);
  },
  {
    message: "Exactly one of 'command' or 'commandId' must be provided, not both",
  }
);

/**
 * Maximum stdout/stderr buffer size per command (1 MB).
 * Prevents unbounded memory from runaway command output.
 */
const MAX_OUTPUT_BYTES = 1_048_576;

/**
 * Command definitions with explicit binary + args for the safer commandId-based path.
 * No shell involved — binaries are invoked directly.
 */
const COMMAND_MAP: Record<string, { cmd: string; args: string[] }> = {
  npm_build:     { cmd: "npm", args: ["run", "build"] },
  npm_dev:       { cmd: "npm", args: ["run", "dev"] },
  npm_install:   { cmd: "npm", args: ["install"] },
  npm_test:      { cmd: "npm", args: ["run", "test"] },
  git_status:    { cmd: "git", args: ["status"] },
  git_diff:      { cmd: "git", args: ["diff"] },
};

/**
 * Legacy string commands that are explicitly allowed (backward compatible).
 * These are still executed via spawn (not shell exec) for safety.
 */
const LEGACY_ALLOWED_COMMANDS: Record<string, { cmd: string; args: string[] }> = {
  "npm run build":   { cmd: "npm", args: ["run", "build"] },
  "npm run dev":     { cmd: "npm", args: ["run", "dev"] },
  "npm install":     { cmd: "npm", args: ["install"] },
  "npm test":        { cmd: "npm", args: ["test"] },
  "git status":      { cmd: "git", args: ["status"] },
  "git diff":        { cmd: "git", args: ["diff"] },
};

/**
 * Execute a command with spawn (no shell).
 * Enforces max buffer size and kills process immediately upon overflow.
 * Logs execution duration on completion.
 */
function executeCommand(
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number; truncated: boolean }> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const workspaceRoot = loadRuntimeConfig().workspaceRoot;
    const spec = resolveCommandSpec(cmd, args);
    const commandForLog = renderCommandForLog(spec.command, spec.args);
    const child = spawn(spec.command, spec.args, {
      cwd: workspaceRoot,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutLimitReached = false;
    let stderrLimitReached = false;

    child.stdout?.on("data", (data: Buffer) => {
      if (!stdoutLimitReached) {
        const chunk = data.toString();
        if (stdout.length + chunk.length > MAX_OUTPUT_BYTES) {
          stdoutLimitReached = true;
          console.error(`[AlfaDev][AUDIT] stdout exceeded ${MAX_OUTPUT_BYTES} bytes, killing process: ${commandForLog}`);
          child.kill("SIGKILL");
          return;
        }
        stdout += chunk;
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      if (!stderrLimitReached) {
        const chunk = data.toString();
        if (stderr.length + chunk.length > MAX_OUTPUT_BYTES) {
          stderrLimitReached = true;
          console.error(`[AlfaDev][AUDIT] stderr exceeded ${MAX_OUTPUT_BYTES} bytes, killing process: ${commandForLog}`);
          child.kill("SIGKILL");
          return;
        }
        stderr += chunk;
      }
    });

    const timer = setTimeout(() => {
      child.kill();
      const durationMs = Date.now() - startTime;
      console.error(`[AlfaDev] Command timed out after ${timeoutMs}ms (duration: ${durationMs}ms): ${commandForLog}`);
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      const truncated = stdoutLimitReached || stderrLimitReached;
      if (truncated) {
        console.error(`[AlfaDev][AUDIT] Command output truncated (duration: ${durationMs}ms, exit: ${exitCode}): ${commandForLog}`);
      } else {
        console.error(`[AlfaDev] Command completed (duration: ${durationMs}ms, exit: ${exitCode}): ${commandForLog}`);
      }
      resolve({ stdout, stderr, exitCode: exitCode ?? 1, durationMs, truncated });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      console.error(`[AlfaDev] Command error (duration: ${durationMs}ms): ${commandForLog} - ${err.message}`);
      reject(err);
    });
  });
}

export async function runCommandToolHandler(input: {
  command?: string;
  commandId?: string;
  timeout?: number;
}, context?: ToolExecutionContext) {
  const normalizedInput = normalizeInput(input);
  const runtimeConfig = loadRuntimeConfig();
  const timeout = Math.min(
    Math.max(typeof normalizedInput.timeout === "number" ? normalizedInput.timeout : runtimeConfig.timeouts.toolMs, 1000),
    300000
  );

  let cmd: string;
  let args: string[];
  let executionMode: "commandId" | "legacy" = "commandId";

  // Prefer commandId-based execution (safer, static args)
  if (normalizedInput.commandId && typeof normalizedInput.commandId === "string") {
    const mapped = COMMAND_MAP[normalizedInput.commandId];
    if (!mapped) {
      console.error(`[AlfaDev][AUDIT] Denied unknown commandId: "${normalizedInput.commandId}"`);
      throw new ToolExecutionErrorClass(
        ErrorCode.COMMAND_DENIED,
        `Unknown commandId: "${normalizedInput.commandId}". Allowed ids: ${Object.keys(COMMAND_MAP).join(", ")}`,
        { tool: "run_command", retryable: false }
      );
    }
    cmd = mapped.cmd;
    args = mapped.args;
  }
  else if (normalizedInput.command && typeof normalizedInput.command === "string") {
    executionMode = "legacy";
    const trimmedCmd = normalizedInput.command.trim();
    const mapped = LEGACY_ALLOWED_COMMANDS[trimmedCmd];
    if (!mapped) {
      console.error(`[AlfaDev][AUDIT] Denied legacy command: "${trimmedCmd}"`);
      throw new ToolExecutionErrorClass(
        ErrorCode.COMMAND_DENIED,
        `Command not allowed: "${trimmedCmd}". Allowed commands: ${Object.keys(LEGACY_ALLOWED_COMMANDS).join(", ")}`,
        { tool: "run_command", retryable: false }
      );
    }
    cmd = mapped.cmd;
    args = mapped.args;
  } else {
    throw new ToolExecutionErrorClass(
      ErrorCode.VALIDATION_FAILED,
      "Either 'commandId' (safer) or 'command' (legacy) parameter is required",
      { tool: "run_command", retryable: false }
    );
  }

  console.error(`[AlfaDev][AUDIT] Executing command via ${executionMode}: ${cmd} ${args.join(" ")}`);
  const quotaScope = context?.metadata.parentRequestId ?? context?.requestId;
  if (quotaScope) {
    globalBudgetEngine.countCommandExecution(quotaScope, undefined);
  }
  const { stdout, stderr, exitCode, durationMs, truncated } = await executeCommand(cmd, args, timeout);
  globalObservability.recordCommandExecution(durationMs, exitCode === 0);

  const output = stdout || stderr || "No output";
  if (exitCode !== 0) {
    throw new ToolExecutionErrorClass(
      ErrorCode.COMMAND_FAILED,
      `Command '${executionMode === "commandId" ? normalizedInput.commandId : normalizedInput.command}' failed with exit code ${exitCode}`,
      {
        tool: "run_command",
        retryable: false,
        details: {
          exitCode,
          durationMs,
          stderr: ToolExecutionErrorClass.sanitizeMessage(stderr || ""),
          stdout: ToolExecutionErrorClass.sanitizeMessage(stdout || ""),
        },
      }
    );
  }

  const text = truncated ? `[Output truncated at ${MAX_OUTPUT_BYTES} bytes]\n${output}` : output;

  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
  };
}
