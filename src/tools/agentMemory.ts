import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const DIR = path.resolve(getWorkspaceRoot(), ".alfa-agent");
const MEMORY_FILE = path.join(DIR, "memory.json");

export async function agentMemoryToolHandler(input: {
  action: "read" | "set" | "delete" | "clear";
  key?: string;
  value?: unknown;
}) {
  await fs.mkdir(DIR, { recursive: true });

  let memory: Record<string, unknown> = {};

  try {
    memory = JSON.parse(await fs.readFile(MEMORY_FILE, "utf-8"));
  } catch {}

  if (input.action === "clear") memory = {};

  if (input.action === "set") {
    if (!input.key) throw new Error("key is required");
    memory[input.key] = input.value ?? null;
  }

  if (input.action === "delete") {
    if (!input.key) throw new Error("key is required");
    delete memory[input.key];
  }

  await fs.writeFile(MEMORY_FILE, JSON.stringify(memory, null, 2), "utf-8");

  return {
    content: [{ type: "text" as const, text: JSON.stringify(memory, null, 2) }]
  };
}

