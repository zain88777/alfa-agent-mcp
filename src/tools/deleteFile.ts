import fs from "fs/promises";
import { z } from "zod";
import { normalizeInput } from "../core/inputNormalizer.js";
import { normalizeSafePath } from "../core/pathSafety.js";
import { enforceProtectedPath } from "../core/protectedPaths.js";
import type { ToolExecutionContext } from "../core/executionContext.js";

export const deleteFileSchema = z.object({
  filePath: z.string().min(1, "filePath is required"),
  dryRun: z.boolean().optional().default(false),
});

export async function deleteFileToolHandler(
  input: { filePath: string; dryRun?: boolean },
  context?: ToolExecutionContext
) {
  const normalizedInput = normalizeInput(input);
  if (!normalizedInput.filePath || typeof normalizedInput.filePath !== "string") {
    throw new Error("Parameter 'filePath' is required and must be a string");
  }
  const safePath = normalizeSafePath(normalizedInput.filePath);

  enforceProtectedPath(safePath, "delete_file", context);

  if (normalizedInput.dryRun === true) {
    return {
      content: [
        {
          type: "text" as const,
          text: `[DRY-RUN] Would delete: ${normalizedInput.filePath}`,
        },
      ],
    };
  }

  await fs.rm(safePath, { force: true });

  return {
    content: [
      {
        type: "text" as const,
        text: "File deleted successfully.",
      },
    ],
  };
}