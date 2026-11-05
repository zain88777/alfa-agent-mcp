import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const DIR = path.resolve(getWorkspaceRoot(), ".alfa-agent");
const FILE = path.join(DIR, "tasks.json");

export async function taskRunnerToolHandler(input: {
  action: "create" | "run" | "list" | "clear";
  name?: string;
  steps?: Array<{ tool: string; input: unknown }>;
}) {
  await fs.mkdir(DIR, { recursive: true });

  let tasks: Record<string, { steps: Array<{ tool: string; input: unknown }>; createdAt: string }> = {};
  try {
    tasks = JSON.parse(await fs.readFile(FILE, "utf-8"));
  } catch {}

  if (input.action === "clear") {
    tasks = {};
  }

  if (input.action === "create") {
    if (!input.name || !input.steps) throw new Error("Invalid task");

    tasks[input.name] = {
      steps: input.steps,
      createdAt: new Date().toISOString()
    };
  }

  if (input.action === "run") {
    const task = tasks[input.name!];
    if (!task) throw new Error("Task not found");

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(task, null, 2)
        }
      ]
    };
  }

  await fs.writeFile(FILE, JSON.stringify(tasks, null, 2), "utf-8");

  return {
    content: [{ type: "text" as const, text: JSON.stringify(tasks, null, 2) }]
  };
}


