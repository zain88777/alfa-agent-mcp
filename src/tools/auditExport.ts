import { z } from "zod";
import { exportAuditLog } from "../core/auditTrail.js";

export const auditExportSchema = z.object({
  path: z.string().optional(),
}).strict();

export async function auditExportToolHandler(input: { path?: string }) {
  const out = await exportAuditLog(input.path);
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ ok: true, path: out.path, eventCount: out.log.eventCount, chainTip: out.log.chainTip, checksum: out.log.checksum }, null, 2),
    }],
  };
}
