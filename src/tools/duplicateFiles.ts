import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";
import crypto from "crypto";

const ROOT = getWorkspaceRoot();
const IGNORED = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

async function walk(dir: string, files: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED.has(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) await walk(full, files);
    else if (entry.isFile()) files.push(full);
  }
}

export async function duplicateFilesToolHandler() {
  const files: string[] = [];
  const hashes: Record<string, string[]> = {};

  await walk(ROOT, files);

  for (const file of files) {
    const buffer = await fs.readFile(file);
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    hashes[hash] = hashes[hash] || [];
    hashes[hash].push(path.relative(ROOT, file));
  }

  const duplicates = Object.values(hashes).filter((group) => group.length > 1);

  return {
    content: [{ type: "text" as const, text: JSON.stringify(duplicates, null, 2) }]
  };
}

