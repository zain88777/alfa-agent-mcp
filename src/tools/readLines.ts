import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";
import { normalizeInput } from "../core/inputNormalizer.js";

const ALLOWED_BASE = getWorkspaceRoot();

function safe(inputPath: string): string {
  const resolved = path.resolve(ALLOWED_BASE, inputPath);
  if (!resolved.startsWith(ALLOWED_BASE)) throw new Error("Access denied");
  return resolved;
}

export async function readLinesToolHandler(input: {
  filePath: string;
  startLine: number;
  endLine: number;
}) {
  const normalizedInput = normalizeInput(input);
  if (!normalizedInput.filePath || typeof normalizedInput.filePath !== "string") {
    throw new Error("Parameter 'filePath' is required and must be a string");
  }
  if (typeof normalizedInput.startLine !== "number") {
    throw new Error("Parameter 'startLine' is required and must be a number");
  }
  if (typeof normalizedInput.endLine !== "number") {
    throw new Error("Parameter 'endLine' is required and must be a number");
  }
  const file = safe(normalizedInput.filePath);
  const data = await fs.readFile(file, "utf-8");
  const lines = data.split(/\r?\n/);

  const start = Math.max(1, normalizedInput.startLine);
  const end = Math.min(lines.length, normalizedInput.endLine);

  const selected = lines
    .slice(start - 1, end)
    .map((line, index) => `${start + index}: ${line}`)
    .join("\n");

  return {
    content: [{ type: "text" as const, text: selected || "No lines found." }]
  };
}

