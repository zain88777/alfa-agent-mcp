import { z } from "zod";
import { ToolRegistry } from "../core/toolRegistry.js";
import { exportRuntimeCheckpoint } from "../core/runtimeCheckpoint.js";

export const checkpointExportSchema = z.object({
  path: z.string().optional(),
}).strict();

export async function checkpointExportToolHandler(input: { path?: string }, registry?: ToolRegistry) {
  if (!registry) throw new Error("checkpoint_export requires registry");
  const result = await exportRuntimeCheckpoint(registry, input.path);
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        ok: true,
        path: result.path,
        schemaVersion: result.checkpoint.schemaVersion,
        createdAt: result.checkpoint.createdAt,
        runtimeVersion: result.checkpoint.runtimeVersion,
        checksum: result.checkpoint.checksum,
      }, null, 2),
    }],
  };
}
