import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const DIR = path.resolve(getWorkspaceRoot(), ".alfa-agent");
const FILE = path.join(DIR, "terminal-history.log");

export async function terminalHistoryToolHandler(input: {
  action: "append" | "read" | "clear";
  text?: string;
}) {
  await fs.mkdir(DIR, { recursive: true });

  if (input.action === "clear") {
    await fs.writeFile(FILE, "", "utf-8");
    return { content: [{ type: "text" as const, text: "Terminal history cleared." }] };
  }

  if (input.action === "append") {
    await fs.appendFile(FILE, `[${new Date().toISOString()}]\n${input.text ?? ""}\n\n`, "utf-8");
    return { content: [{ type: "text" as const, text: "Terminal output saved." }] };
  }

  try {
    const data = await fs.readFile(FILE, "utf-8");
    return { content: [{ type: "text" as const, text: data || "No terminal history." }] };
  } catch {
    return { content: [{ type: "text" as const, text: "No terminal history." }] };
  }
}


