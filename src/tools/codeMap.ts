import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const ROOT = getWorkspaceRoot();
const IGNORED = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);

async function walk(dir: string, files: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED.has(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) await walk(full, files);
    else if (entry.isFile() && CODE_EXTS.has(path.extname(entry.name))) files.push(full);
  }
}

export async function codeMapToolHandler() {
  const files: string[] = [];
  const map: Record<string, string[]> = {};

  await walk(ROOT, files);

  for (const file of files) {
    const text = await fs.readFile(file, "utf-8");
    const symbols = [
      ...text.matchAll(/\bexport\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g),
      ...text.matchAll(/\bfunction\s+([A-Za-z0-9_]+)/g),
      ...text.matchAll(/\bclass\s+([A-Za-z0-9_]+)/g),
      ...text.matchAll(/\bconst\s+([A-Za-z0-9_]+)\s*=/g)
    ].map((m) => m[1]);

    map[path.relative(ROOT, file)] = [...new Set(symbols)];
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify(map, null, 2) }]
  };
}

