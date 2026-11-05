import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { normalizeInput } from "../core/inputNormalizer.js";
import { normalizeSafePath } from "../core/pathSafety.js";

export const searchFilesSchema = z.object({
  query: z.string().min(1, "Search query is required"),
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

async function walkDirectory(
  dirPath: string,
  query: string,
  results: string[],
  basePath: string
): Promise<void> {
  if (results.length >= MAX_RESULTS) return;

  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (results.length >= MAX_RESULTS) return;

    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      await walkDirectory(fullPath, query, results, basePath);
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().includes(query.toLowerCase())) {
      results.push(path.relative(basePath, fullPath));
    }
  }
}

export async function searchFilesToolHandler(input: {
  query: string;
  directory?: string;
}) {
  const normalizedInput = normalizeInput(input);

  const query = (normalizedInput?.query ?? "").trim();

  if (!query) {
    throw new Error("Search query is required");
  }

  const baseDir = normalizeSafePath(normalizedInput?.directory || ".");
  const results: string[] = [];

  await walkDirectory(baseDir, query, results, baseDir);

  return {
    content: [
      {
        type: "text" as const,
        text: results.length
          ? results.join("\n")
          : "No matching files found."
      }
    ]
  };
}
