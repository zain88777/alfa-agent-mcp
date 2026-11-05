import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const DIR = path.resolve(getWorkspaceRoot(), ".alfa-agent");
const FILE = path.join(DIR, "goal.json");
type GoalState = {
  goal?: string;
  steps?: string[];
  status?: "active" | "paused";
  createdAt?: string;
  updatedAt?: string;
};

export async function goalWorkflowToolHandler(input: {
  action: "create" | "read" | "pause" | "resume" | "clear";
  goal?: string;
  steps?: string[];
}) {
  await fs.mkdir(DIR, { recursive: true });

  if (input.action === "clear") {
    await fs.writeFile(FILE, JSON.stringify({}, null, 2), "utf-8");
    return { content: [{ type: "text" as const, text: "Goal cleared." }] };
  }

  if (input.action === "create") {
    const data = {
      goal: input.goal ?? "",
      steps: input.steps ?? [],
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await fs.writeFile(FILE, JSON.stringify(data, null, 2), "utf-8");
    return { content: [{ type: "text" as const, text: "Goal created." }] };
  }

  let current: GoalState = {};
  try {
    current = JSON.parse(await fs.readFile(FILE, "utf-8"));
  } catch {}

  if (input.action === "pause") current.status = "paused";
  if (input.action === "resume") current.status = "active";
  current.updatedAt = new Date().toISOString();

  await fs.writeFile(FILE, JSON.stringify(current, null, 2), "utf-8");

  return {
    content: [{ type: "text" as const, text: JSON.stringify(current, null, 2) }]
  };
}


