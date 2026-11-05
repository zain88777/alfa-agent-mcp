import fs from "fs/promises";
import { z } from "zod";
import { normalizeInput } from "../core/inputNormalizer.js";
import { normalizeSafePath } from "../core/pathSafety.js";

export const replaceTextSchema = z.object({
  filePath: z.string().min(1, "filePath is required"),
  search: z.string().min(1, "search is required"),
  replacement: z.string(),
}).strict();

export async function replaceTextToolHandler(input: {
  filePath?: string;
  search?: string;
  replacement?: string;
}) {
  const normalizedInput = normalizeInput(input);
  if (!normalizedInput.filePath || typeof normalizedInput.filePath !== "string") {
    throw new Error("Parameter 'filePath' is required and must be a string");
  }
  if (typeof normalizedInput.search !== "string") {
    throw new Error("Parameter 'search' is required and must be a string");
  }
  if (typeof normalizedInput.replacement !== "string") {
    throw new Error("Parameter 'replacement' is required and must be a string");
  }

  const safePath = normalizeSafePath(normalizedInput.filePath);
  const data = await fs.readFile(safePath, "utf-8");
  const result = data.replaceAll(normalizedInput.search, normalizedInput.replacement);
  await fs.writeFile(safePath, result, "utf-8");

  return {
    content: [{ type: "text" as const, text: "Text replaced successfully." }]
  };
}
