import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";
import { normalizeInput } from "../core/inputNormalizer.js";

const ROOT = getWorkspaceRoot();
const IGNORED = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
const EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);

async function walk(dir: string, files: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED.has(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) await walk(full, files);
    else if (entry.isFile() && EXTS.has(path.extname(entry.name))) files.push(full);
  }
}

export async function impactAnalysisToolHandler(input: { targetFile?: string }) {
  const normalizedInput = normalizeInput(input);
  if (!normalizedInput.targetFile || typeof normalizedInput.targetFile !== "string") {
    throw new Error("Parameter 'targetFile' is required and must be a string");
  }

  const files: string[] = [];
  const targetBase = path.basename(normalizedInput.targetFile, path.extname(normalizedInput.targetFile));
  const impacted: string[] = [];

  await walk(ROOT, files);

  for (const file of files) {
    const text = await fs.readFile(file, "utf-8");

    if (
      text.includes(normalizedInput.targetFile) ||
      text.includes(`/${targetBase}`) ||
      text.includes(`./${targetBase}`) ||
      text.includes(`../${targetBase}`)
    ) {
      impacted.push(path.relative(ROOT, file));
    }
  }

  return {
    content: [
      {
        type: "text" as const,
        text: impacted.length ? impacted.join("\n") : "No obvious impacted files found."
      }
    ]
  };
}

