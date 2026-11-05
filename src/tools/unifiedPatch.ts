import fs from "fs/promises";
import { normalizeInput } from "../core/inputNormalizer.js";
import { normalizeSafePath } from "../core/pathSafety.js";
import { enforceProtectedPath } from "../core/protectedPaths.js";
import type { ToolExecutionContext } from "../core/executionContext.js";

export async function unifiedPatchToolHandler(
  input: { filePath: string; search: string; replace: string; dryRun?: boolean },
  context?: ToolExecutionContext
) {
  const normalizedInput = normalizeInput(input) as { filePath: string; search: string; replace: string; dryRun?: boolean };
  if (!normalizedInput.search) throw new Error("search is required");

  const safePath = normalizeSafePath(normalizedInput.filePath);
  enforceProtectedPath(safePath, "unified_patch", context);

  const before = await fs.readFile(safePath, "utf-8");

  if (!before.includes(normalizedInput.search)) {
    throw new Error("Patch failed: search block not found");
  }

  const after = before.replace(normalizedInput.search, normalizedInput.replace);

  if (normalizedInput.dryRun === true) {
    return {
      content: [
        {
          type: "text" as const,
          text: `[DRY-RUN] Would patch: ${normalizedInput.filePath}`,
        },
      ],
    };
  }

  await fs.writeFile(safePath, after, "utf-8");

  return {
    content: [{ type: "text" as const, text: "Unified-style patch applied." }],
  };
}