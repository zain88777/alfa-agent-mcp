import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { normalizeInput } from "../core/inputNormalizer.js";
import { normalizeSafePath } from "../core/pathSafety.js";
import { enforceProtectedPath } from "../core/protectedPaths.js";
import type { ToolExecutionContext } from "../core/executionContext.js";

export const copyFileSchema = z.object({
  from: z.string().min(1, "'from' is required"),
  to: z.string().min(1, "'to' is required"),
  dryRun: z.boolean().optional().default(false),
});

export async function copyFileToolHandler(
  input: { from?: string; to?: string; dryRun?: boolean },
  context?: ToolExecutionContext
) {
  const normalizedInput = normalizeInput(input);
  if (!normalizedInput.from || typeof normalizedInput.from !== "string") {
    throw new Error("Parameter 'from' is required and must be a string");
  }
  if (!normalizedInput.to || typeof normalizedInput.to !== "string") {
    throw new Error("Parameter 'to' is required and must be a string");
  }

  const from = normalizeSafePath(normalizedInput.from);
  const to = normalizeSafePath(normalizedInput.to);

  enforceProtectedPath(from, "copy_file", context);
  enforceProtectedPath(to, "copy_file", context);

  if (normalizedInput.dryRun === true) {
    return {
      content: [
        {
          type: "text" as const,
          text: `[DRY-RUN] Would copy: ${normalizedInput.from} → ${normalizedInput.to}`,
        },
      ],
    };
  }

  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);

  return {
    content: [{ type: "text" as const, text: "File copied successfully." }],
  };
}