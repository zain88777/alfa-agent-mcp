import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const ALLOWED_BASE = getWorkspaceRoot();
const MAX_DEPTH = 4;

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".cache",
  "coverage"
]);

function resolveSafePath(inputPath: string): string {
  const resolved = path.resolve(ALLOWED_BASE, inputPath || ".");
  if (!resolved.startsWith(ALLOWED_BASE)) throw new Error("Access denied");
  return resolved;
}

async function buildTree(dir: string, depth: number, lines: string[]): Promise<void> {
  if (depth > MAX_DEPTH) return;

  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;

    const prefix = "  ".repeat(depth);
    lines.push(`${prefix}${entry.isDirectory() ? "📁" : "📄"} ${entry.name}`);

    if (entry.isDirectory()) {
      await buildTree(path.join(dir, entry.name), depth + 1, lines);
    }
  }
}

export async function projectTreeToolHandler(input: { directory?: string }) {
  const baseDir = resolveSafePath(input.directory || ".");
  const lines: string[] = [];

  await buildTree(baseDir, 0, lines);

  return {
    content: [
      {
        type: "text" as const,
        text: lines.join("\n") || "Empty directory."
      }
    ]
  };
}

