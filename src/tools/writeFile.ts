import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { normalizeInput } from "../core/inputNormalizer.js";
import { normalizeSafePath } from "../core/pathSafety.js";
import { enforceProtectedPath } from "../core/protectedPaths.js";
import type { ToolExecutionContext } from "../core/executionContext.js";

export const writeFileSchema = z.object({
  filePath: z.string().min(1, "filePath is required"),
  content: z.string().min(0, "content is required"),
  dryRun: z.boolean().optional().default(false),
});

export async function writeFileToolHandler(
  input: { filePath: string; content: string; dryRun?: boolean },
  context?: ToolExecutionContext
) {
  const normalizedInput = normalizeInput(input);
  if (!normalizedInput.filePath || typeof normalizedInput.filePath !== "string") {
    throw new Error("Parameter 'filePath' is required and must be a string");
  }
  if (typeof normalizedInput.content !== "string") {
    throw new Error("Parameter 'content' is required and must be a string");
  }
  const safePath = normalizeSafePath(normalizedInput.filePath);

  enforceProtectedPath(safePath, "write_file", context);

  if (normalizedInput.dryRun === true) {
    return {
      content: [
        {
          type: "text" as const,
          text: `[DRY-RUN] Would write to: ${normalizedInput.filePath} (${normalizedInput.content.length} bytes)`,
        },
      ],
    };
  }

  await fs.mkdir(path.dirname(safePath), { recursive: true });
  await fs.writeFile(safePath, normalizedInput.content, "utf-8");

  return {
    content: [
      {
        type: "text" as const,
        text: "File written successfully.",
      },
    ],
  };
}