import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const ROOT = getWorkspaceRoot();
const IGNORED = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

async function walk(dir: string, results: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED.has(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walk(full, results);
      continue;
    }

    if (!entry.isFile()) continue;

    try {
      const text = await fs.readFile(full, "utf-8");
      text.split(/\r?\n/).forEach((line, index) => {
        const matches = line.match(/process\.env\.([A-Z0-9_]+)/g);
        if (matches) {
          results.push(`${path.relative(ROOT, full)}:${index + 1}: ${[...new Set(matches)].join(", ")}`);
        }
      });
    } catch {}
  }
}

export async function envScanToolHandler() {
  const results: string[] = [];
  await walk(ROOT, results);

  return {
    content: [{ type: "text" as const, text: results.join("\n") || "No process.env usage found." }]
  };
}

