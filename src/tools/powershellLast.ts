import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const LOG_FILE = path.resolve(getWorkspaceRoot(), ".alfa-agent", "powershell-history.json");

export async function powershellLastToolHandler() {
  let history: unknown[] = [];

  try {
    history = JSON.parse(await fs.readFile(LOG_FILE, "utf-8"));
  } catch {}

  const last = history.length ? history[history.length - 1] : null;

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(last ?? { message: "No PowerShell history found." }, null, 2)
      }
    ]
  };
}

