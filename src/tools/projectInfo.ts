import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const ROOT = getWorkspaceRoot();

export async function projectInfoToolHandler() {
  let pkg = "No package.json found";

  try {
    const packagePath = path.join(ROOT, "package.json");
    const data = await fs.readFile(packagePath, "utf-8");
    pkg = data;
  } catch {}

  return {
    content: [
      {
        type: "text" as const,
        text: pkg
      }
    ]
  };
}


