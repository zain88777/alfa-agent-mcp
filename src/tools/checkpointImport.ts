import { z } from "zod";
import { importRuntimeCheckpoint, applyRuntimeCheckpoint } from "../core/runtimeCheckpoint.js";
import { ToolRegistry } from "../core/toolRegistry.js";

export const checkpointImportSchema = z.object({
  path: z.string().optional(),
}).strict();

export async function checkpointImportToolHandler(input: { path?: string }, registry?: ToolRegistry) {
  if (!registry) throw new Error("checkpoint_import requires registry");
  const checkpoint = await importRuntimeCheckpoint(input.path);
  applyRuntimeCheckpoint(registry, checkpoint);
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        ok: true,
        schemaVersion: checkpoint.schemaVersion,
        createdAt: checkpoint.createdAt,
        runtimeVersion: checkpoint.runtimeVersion,
        checksum: checkpoint.checksum,
        summary: {
          transactions: checkpoint.data.transactionSummary,
          approvals: checkpoint.data.approvals.length,
          cacheEntries: checkpoint.data.cache.entries,
          quotaViolations: checkpoint.data.quota.violations,
        },
      }, null, 2),
    }],
  };
}
