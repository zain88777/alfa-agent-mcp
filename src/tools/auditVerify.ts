import { z } from "zod";
import { verifyAuditLog } from "../core/auditTrail.js";

export const auditVerifySchema = z.object({
  path: z.string().optional(),
}).strict();

export async function auditVerifyToolHandler(input: { path?: string }) {
  const out = await verifyAuditLog(input.path);
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ ok: out.valid, eventCount: out.eventCount, errors: out.errors }, null, 2),
    }],
  };
}
