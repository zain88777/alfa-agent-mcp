import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { normalizeInput } from "../core/inputNormalizer.js";
import { normalizeSafePath } from "../core/pathSafety.js";

export const restoreBackupFileSchema = z.object({
  backupPath: z.string().min(1, "backupPath is required"),
  targetPath: z.string().min(1, "targetPath is required"),
});

export async function restoreBackupFileToolHandler(input: {
  backupPath: string;
  targetPath: string;
}) {
  const normalizedInput = normalizeInput(input);
  if (!normalizedInput.backupPath || typeof normalizedInput.backupPath !== "string") {
    throw new Error("Parameter 'backupPath' is required and must be a string");
  }
  if (!normalizedInput.targetPath || typeof normalizedInput.targetPath !== "string") {
    throw new Error("Parameter 'targetPath' is required and must be a string");
  }
  const backup = normalizeSafePath(normalizedInput.backupPath);
  const target = normalizeSafePath(normalizedInput.targetPath);

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(backup, target);

  return {
    content: [{ type: "text" as const, text: "Backup restored successfully." }]
  };
}
