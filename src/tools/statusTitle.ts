import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const DIR = path.resolve(getWorkspaceRoot(), ".alfa-agent");
const FILE = path.join(DIR, "status.json");

export async function statusTitleToolHandler(input: {
  title?: string;
  status?: string;
}) {
  await fs.mkdir(DIR, { recursive: true });

  const data = {
    title: input.title ?? "",
    status: input.status ?? "",
    updatedAt: new Date().toISOString()
  };

  await fs.writeFile(FILE, JSON.stringify(data, null, 2), "utf-8");

  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }]
  };
}


