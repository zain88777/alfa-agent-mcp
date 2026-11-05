import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const CONFIG_DIR = path.resolve(getWorkspaceRoot(), ".alfa-agent");
const CONFIG_FILE = path.join(CONFIG_DIR, "workspace.json");

export async function workspaceConfigToolHandler(input: {
  mode: "read" | "write";
  data?: unknown;
}) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });

  if (input.mode === "write") {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(input.data ?? {}, null, 2), "utf-8");
    return { content: [{ type: "text" as const, text: "Workspace config saved." }] };
  }

  try {
    const data = await fs.readFile(CONFIG_FILE, "utf-8");
    return { content: [{ type: "text" as const, text: data }] };
  } catch {
    return { content: [{ type: "text" as const, text: "{}" }] };
  }
}

