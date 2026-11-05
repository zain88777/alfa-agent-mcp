import fs from "fs/promises";
import { z } from "zod";
import { normalizeInput } from "../core/inputNormalizer.js";
import { normalizeSafePath } from "../core/pathSafety.js";

export const readFileSchema = z.object({
  filePath: z.string().min(1, "filePath is required"),
});

export async function readFileToolHandler(input: { filePath?: string }) {
  const normalizedInput = normalizeInput(input);
  if (!normalizedInput.filePath || typeof normalizedInput.filePath !== "string") {
    throw new Error("Parameter 'filePath' is required and must be a string");
  }

  const safePath = normalizeSafePath(normalizedInput.filePath);
  const data = await fs.readFile(safePath, "utf-8");

  return {
    content: [
      {
        type: "text" as const,
        text: data
      }
    ]
  };
}
