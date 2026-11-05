import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { normalizeInput } from "../core/inputNormalizer.js";
import { normalizeSafePath } from "../core/pathSafety.js";

/**
 * Recursive JSON-safe value schema.
 * Accepts strings, numbers, booleans, null, arrays, and plain objects.
 * Rejects functions, classes, symbols, undefined.
 */
const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

export const writeJsonSchema = z.object({
  filePath: z.string().min(1, "filePath is required"),
  data: jsonValueSchema,
}).strict();

export async function writeJsonToolHandler(input: {
  filePath: string;
  data: unknown;
}) {
  const normalizedInput = normalizeInput(input);
  if (!normalizedInput.filePath || typeof normalizedInput.filePath !== "string") {
    throw new Error("Parameter 'filePath' is required and must be a string");
  }
  if (normalizedInput.data === undefined || normalizedInput.data === null) {
    throw new Error("Parameter 'data' is required");
  }
  const safePath = normalizeSafePath(normalizedInput.filePath);
  await fs.mkdir(path.dirname(safePath), { recursive: true });
  await fs.writeFile(safePath, JSON.stringify(normalizedInput.data, null, 2), "utf-8");

  return {
    content: [
      {
        type: "text" as const,
        text: "JSON written successfully."
      }
    ]
  };
}
