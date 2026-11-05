import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const DIR = path.resolve(getWorkspaceRoot(), ".alfa-agent");
const PLAN_FILE = path.join(DIR, "plan.json");

export async function agentPlanToolHandler(input: {
  action: "read" | "write" | "clear";
  title?: string;
  steps?: string[];
}) {
  await fs.mkdir(DIR, { recursive: true });

  if (input.action === "clear") {
    await fs.writeFile(PLAN_FILE, JSON.stringify({ title: "", steps: [] }, null, 2), "utf-8");
    return { content: [{ type: "text" as const, text: "Plan cleared." }] };
  }

  if (input.action === "write") {
    const plan = {
      title: input.title ?? "",
      steps: input.steps ?? [],
      updatedAt: new Date().toISOString()
    };

    await fs.writeFile(PLAN_FILE, JSON.stringify(plan, null, 2), "utf-8");
    return { content: [{ type: "text" as const, text: "Plan saved." }] };
  }

  try {
    const data = await fs.readFile(PLAN_FILE, "utf-8");
    return { content: [{ type: "text" as const, text: data }] };
  } catch {
    return { content: [{ type: "text" as const, text: "{}" }] };
  }
}

