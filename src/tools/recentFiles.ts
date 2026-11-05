import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const ROOT = getWorkspaceRoot();
const IGNORED = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

async function walk(dir: string, files: { file: string; modifiedAt: Date }[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED.has(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walk(full, files);
      continue;
    }

    if (entry.isFile()) {
      const stat = await fs.stat(full);
      files.push({ file: path.relative(ROOT, full), modifiedAt: stat.mtime });
    }
  }
}

export async function recentFilesToolHandler(input: { limit?: number }) {
  const files: { file: string; modifiedAt: Date }[] = [];
  await walk(ROOT, files);

  const result = files
    .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
    .slice(0, input.limit ?? 30);

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }]
  };
}

