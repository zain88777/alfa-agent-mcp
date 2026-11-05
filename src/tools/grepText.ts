import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { normalizeInput } from "../core/inputNormalizer.js";
import { normalizeSafePath } from "../core/pathSafety.js";

export const grepTextSchema = z.object({
  query: z.string().min(1, "Query is required"),
  directory: z.string().optional().default("."),
});

const MAX_RESULTS = 100;

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".cache",
  "coverage"
]);

async function walk(dir: string, query: string, results: string[], baseDir: string): Promise<void> {
  if (results.length >= MAX_RESULTS) return;

  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (results.length >= MAX_RESULTS) return;
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walk(fullPath, query, results, baseDir);
      continue;
    }

    if (!entry.isFile()) continue;

    try {
      const data = await fs.readFile(fullPath, "utf-8");
      const lines = data.split(/\r?\n/);

      lines.forEach((line, index) => {
        if (results.length >= MAX_RESULTS) return;
        if (line.toLowerCase().includes(query.toLowerCase())) {
          results.push(`${path.relative(baseDir, fullPath)}:${index + 1}: ${line.trim()}`);
        }
      });
    } catch {
      /* intentionally silent - skip unreadable files */
    }
  }
}

export async function grepTextToolHandler(input: {
  query?: string;
  directory?: string;
}) {
  const normalizedInput = normalizeInput(input);
  if (!normalizedInput.query || typeof normalizedInput.query !== "string") {
    throw new Error("Parameter 'query' is required and must be a string");
  }

  const query = normalizedInput.query.trim();
  if (!query) throw new Error("Query cannot be empty");

  const baseDir = normalizeSafePath(normalizedInput.directory || ".");
  const results: string[] = [];

  await walk(baseDir, query, results, baseDir);

  return {
    content: [
      {
        type: "text" as const,
        text: results.length ? results.join("\n") : "No text matches found."
      }
    ]
  };
}
