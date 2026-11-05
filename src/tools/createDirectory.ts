import fs from "fs/promises";
import { z } from "zod";
import { normalizeInput } from "../core/inputNormalizer.js";
import { normalizeSafePath } from "../core/pathSafety.js";

export const createDirectorySchema = z.object({
  directory: z.string().min(1, "directory is required"),
});

export async function createDirectoryToolHandler(input: { directory: string }) {
  const normalizedInput = normalizeInput(input);
  if (!normalizedInput.directory || typeof normalizedInput.directory !== "string") {
    throw new Error("Parameter 'directory' is required and must be a string");
  }
  const dir = normalizeSafePath(normalizedInput.directory);
  await fs.mkdir(dir, { recursive: true });

  return {
    content: [{ type: "text" as const, text: "Directory created successfully." }]
  };
}
