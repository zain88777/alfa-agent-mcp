import fs from "fs/promises";
import { z } from "zod";
import { normalizeInput } from "../core/inputNormalizer.js";
import { normalizeSafePath } from "../core/pathSafety.js";
import { enforceProtectedPath } from "../core/protectedPaths.js";
import type { ToolExecutionContext } from "../core/executionContext.js";

export const applyPatchSchema = z.object({
  filePath: z.string().min(1, "filePath is required"),
  patch: z.string().min(1, "patch is required"),
  dryRun: z.boolean().optional().default(false),
}).strict();

export async function applyPatchToolHandler(
  input: { filePath?: string; patch?: string; dryRun?: boolean },
  context?: ToolExecutionContext
) {
  const normalizedInput = normalizeInput(input);
  if (!normalizedInput.filePath || typeof normalizedInput.filePath !== "string") {
    throw new Error("Parameter 'filePath' is required and must be a string");
  }
  if (!normalizedInput.patch || typeof normalizedInput.patch !== "string") {
    throw new Error("Parameter 'patch' is required and must be a string");
  }

  const safePath = normalizeSafePath(normalizedInput.filePath);
  enforceProtectedPath(safePath, "apply_patch", context);

  const currentContent = await fs.readFile(safePath, "utf-8");
  const lines = currentContent.split(/\r?\n/);

  const patchLines = normalizedInput.patch.split("\n");
  let modified = [...lines];

  for (const pl of patchLines) {
    const trimmed = pl.trim();
    if (trimmed.startsWith("-")) {
      const target = trimmed.slice(1).trim();
      const idx = modified.indexOf(target);
      if (idx !== -1) modified.splice(idx, 1);
    } else if (trimmed.startsWith("+")) {
      modified.push(trimmed.slice(1));
    } else if (trimmed.startsWith("=")) {
      const parts = trimmed.slice(1).split("||");
      if (parts.length === 2) {
        const idx = modified.indexOf(parts[0].trim());
        if (idx !== -1) modified[idx] = parts[1].trim();
      }
    }
  }

  const newContent = modified.join("\n");

  if (normalizedInput.dryRun === true) {
    return {
      content: [
        {
          type: "text" as const,
          text: `[DRY-RUN] Would patch: ${normalizedInput.filePath} (${patchLines.length} patch lines)`,
        },
      ],
    };
  }

  await fs.writeFile(safePath, newContent, "utf-8");

  return {
    content: [{ type: "text" as const, text: "Patch applied successfully." }],
  };
}