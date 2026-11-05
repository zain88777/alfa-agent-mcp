import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const ROOT = getWorkspaceRoot();
const IGNORED = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

async function walk(dir: string, files: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED.has(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) await walk(full, files);
    else if (entry.isFile() && CODE_EXTS.has(path.extname(entry.name))) files.push(full);
  }
}

export async function importGraphToolHandler() {
  const files: string[] = [];
  const graph: Record<string, string[]> = {};

  await walk(ROOT, files);

  for (const file of files) {
    const text = await fs.readFile(file, "utf-8");
    const imports = [...text.matchAll(/(?:import|export)\s+.*?\s+from\s+["']([^"']+)["']/g)]
      .map((m) => m[1])
      .filter(Boolean);

    graph[path.relative(ROOT, file)] = imports;
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify(graph, null, 2) }]
  };
}

