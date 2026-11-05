import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const ALLOWED_BASE = getWorkspaceRoot();
const MAX_RESULTS = 200;
const IGNORED = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

async function walk(dir: string, results: string[]): Promise<void> {
  if (results.length >= MAX_RESULTS) return;

  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (results.length >= MAX_RESULTS) return;
    if (entry.isDirectory() && IGNORED.has(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walk(full, results);
      continue;
    }

    if (!entry.isFile()) continue;

    try {
      const data = await fs.readFile(full, "utf-8");
      data.split(/\r?\n/).forEach((line, i) => {
        if (/\b(TODO|FIXME|HACK|BUG|new needs to complete)\b/i.test(line)) {
          results.push(`${path.relative(ALLOWED_BASE, full)}:${i + 1}: ${line.trim()}`);
        }
      });
    } catch {}
  }
}

export async function todoScanToolHandler() {
  const results: string[] = [];
  await walk(ALLOWED_BASE, results);

  return {
    content: [{ type: "text" as const, text: results.join("\n") || "No TODO/FIXME markers found." }]
  };
}

