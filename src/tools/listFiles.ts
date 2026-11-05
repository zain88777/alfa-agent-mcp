import fs from "fs/promises";
import { z } from "zod";
import { normalizeSafePath } from "../core/pathSafety.js";

export const listFilesSchema = z.object({
  directory: z.string().optional().default("."),
});

export async function listFilesToolHandler(input: {
  directory?: string;
}) {
  const dir = normalizeSafePath(input.directory || ".");
  const files = await fs.readdir(dir);

  return {
    content: [
      {
        type: "text" as const,
        text: files.join("\n")
      }
    ]
  };
}
