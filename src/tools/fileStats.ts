import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";
import { normalizeInput } from "../core/inputNormalizer.js";

const ALLOWED_BASE = getWorkspaceRoot();

function resolveSafePath(inputPath: string): string {
  const resolved = path.resolve(ALLOWED_BASE, inputPath);
  if (!resolved.startsWith(ALLOWED_BASE)) throw new Error("Access denied");
  return resolved;
}

export async function fileStatsToolHandler(input: { filePath?: string }) {
  const normalizedInput = normalizeInput(input);
  if (!normalizedInput.filePath || typeof normalizedInput.filePath !== "string") {
    throw new Error("Parameter 'filePath' is required and must be a string");
  }

  const safePath = resolveSafePath(normalizedInput.filePath);
  const stat = await fs.stat(safePath);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            path: path.relative(ALLOWED_BASE, safePath),
            sizeBytes: stat.size,
            isFile: stat.isFile(),
            isDirectory: stat.isDirectory(),
            createdAt: stat.birthtime,
            modifiedAt: stat.mtime
          },
          null,
          2
        )
      }
    ]
  };
}

