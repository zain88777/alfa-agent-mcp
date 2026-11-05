import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { normalizeInput } from "../core/inputNormalizer.js";
import { normalizeSafePath } from "../core/pathSafety.js";

export const safeBackupFileSchema = z.object({
  filePath: z.string().min(1, "filePath is required"),
});

const BACKUP_DIR = path.resolve(normalizeSafePath("."), ".alfa-agent", "backups");

export async function safeBackupFileToolHandler(input: { filePath?: string }) {
  const normalizedInput = normalizeInput(input);
  if (!normalizedInput.filePath || typeof normalizedInput.filePath !== "string") {
    throw new Error("Parameter 'filePath' is required and must be a string");
  }

  const source = normalizeSafePath(normalizedInput.filePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupName = `${normalizedInput.filePath.replace(/[\\\/]/g, "__")}.${stamp}.bak`;
  const target = path.join(BACKUP_DIR, backupName);

  await fs.mkdir(BACKUP_DIR, { recursive: true });
  await fs.copyFile(source, target);

  return {
    content: [{ type: "text" as const, text: `Backup created.` }]
  };
}
