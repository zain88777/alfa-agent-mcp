import { z } from "zod";
import { globalAuditTrail, readAuditLog, simulateReplay } from "../core/auditTrail.js";

export const replaySimulateSchema = z.object({
  path: z.string().optional(),
}).strict();

export async function replaySimulateToolHandler(input: { path?: string }) {
  const events = input.path ? (await readAuditLog(input.path)).events : globalAuditTrail.snapshot();
  const summary = simulateReplay(events);
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(summary, null, 2),
    }],
  };
}
