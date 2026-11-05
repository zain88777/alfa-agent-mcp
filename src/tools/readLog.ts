import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const LOG_FILE = path.resolve(getWorkspaceRoot(), ".alfa-agent", "agent.log");

export async function readLogToolHandler() {
  let data = "";

  try {
    data = await fs.readFile(LOG_FILE, "utf-8");
  } catch {
    data = "No logs found.";
  }

  return {
    content: [
      {
        type: "text" as const,
        text: data
      }
    ]
  };
}

