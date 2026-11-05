import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";
import { execFile } from "child_process";
import util from "util";
import { normalizeInput } from "../core/inputNormalizer.js";
import { loadRuntimeConfig } from "../core/runtimeConfig.js";

const execFileAsync = util.promisify(execFile);
type ExecFailure = Error & { stdout?: string; stderr?: string };
const ROOT = getWorkspaceRoot();
const LOG_DIR = path.resolve(ROOT, ".alfa-agent");
const LOG_FILE = path.join(LOG_DIR, "powershell-history.json");

const ALLOWED_PREFIXES = [
  "npm ",
  "npx ",
  "git ",
  "dir",
  "type ",
  "tree ",
  "findstr ",
  "echo ",
  "node ",
  "tsc "
];

function isAllowed(command: string): boolean {
  const cmd = command.trim().toLowerCase();

  if (!cmd) return false;

  const blocked = [
    "rm ",
    "del ",
    "rmdir ",
    "rd ",
    "format",
    "shutdown",
    "restart-computer",
    "remove-item",
    "set-executionpolicy",
    "invoke-webrequest",
    "iwr ",
    "curl ",
    "wget "
  ];

  if (blocked.some((item) => cmd.includes(item))) {
    return false;
  }

  return ALLOWED_PREFIXES.some((prefix) => cmd.startsWith(prefix));
}

async function appendHistory(entry: unknown) {
  await fs.mkdir(LOG_DIR, { recursive: true });

  let history: unknown[] = [];

  try {
    history = JSON.parse(await fs.readFile(LOG_FILE, "utf-8"));
  } catch {}

  history.push(entry);

  await fs.writeFile(LOG_FILE, JSON.stringify(history.slice(-100), null, 2), "utf-8");
}

export async function powershellRunToolHandler(input: {
  command: string;
  timeoutMs?: number;
}) {
  const normalizedInput = normalizeInput(input);
  if (!normalizedInput.command || typeof normalizedInput.command !== "string") {
    throw new Error("Parameter 'command' is required and must be a string");
  }
  const command = normalizedInput.command.trim();
  const runtimeConfig = loadRuntimeConfig();
  const allowDangerousOverride = runtimeConfig.mcp.allowDangerousTools;

  // Local developer override for dangerous-tier tools: if enabled, allow
  // arbitrary PowerShell commands while still preserving audit logging and
  // timeout controls for this tool.
  if (!allowDangerousOverride && !isAllowed(command)) {
    throw new Error(`PowerShell command not allowed: ${command}`);
  }

  const startedAt = new Date().toISOString();

  try {
    const { stdout, stderr } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      {
        cwd: ROOT,
        shell: false,
        timeout: normalizedInput.timeoutMs ?? 30000,
        maxBuffer: 1024 * 1024 * 10
      }
    );

    const result = {
      command,
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: true,
      stdout,
      stderr
    };

    await appendHistory(result);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error: unknown) {
    const execError = error as ExecFailure;
    const result = {
      command,
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: false,
      stdout: execError.stdout || "",
      stderr: execError.stderr || "",
      message: execError.message || "PowerShell command failed"
    };

    await appendHistory(result);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
}

