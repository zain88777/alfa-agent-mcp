import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const LOG_FILE = path.resolve(getWorkspaceRoot(), ".alfa-agent", "powershell-history.json");

export async function powershellHistoryToolHandler(input?: {
  limit?: number;
}) {
  let history: unknown[] = [];

  try {
    history = JSON.parse(await fs.readFile(LOG_FILE, "utf-8"));
  } catch {}

  const limit = input?.limit ?? 20;
  const result = history.slice(-limit);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
}

