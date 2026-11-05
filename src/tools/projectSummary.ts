import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const ROOT = getWorkspaceRoot();
const IGNORED = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

async function countFiles(dir: string, stats: Record<string, number>): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED.has(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await countFiles(full, stats);
      continue;
    }

    if (entry.isFile()) {
      const ext = path.extname(entry.name) || "[no-ext]";
      stats[ext] = (stats[ext] || 0) + 1;
    }
  }
}

export async function projectSummaryToolHandler() {
  const stats: Record<string, number> = {};
  await countFiles(ROOT, stats);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            root: ROOT,
            fileTypes: stats
          },
          null,
          2
        )
      }
    ]
  };
}

