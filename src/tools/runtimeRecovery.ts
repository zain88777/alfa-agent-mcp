import { z } from "zod";
import { ToolRegistry } from "../core/toolRegistry.js";
import { buildRecoveryReport, applyRecoveryAction } from "../core/runtimeRecovery.js";
import { persistRuntimeState } from "../core/runtimePersistence.js";

export const runtimeRecoverySchema = z.object({
  action: z.enum(["report", "inspect", "mark_stale_failed", "rollback_if_eligible"]).default("report"),
  sessionId: z.string().optional(),
}).strict();

export async function runtimeRecoveryToolHandler(input: { action?: "report" | "inspect" | "mark_stale_failed" | "rollback_if_eligible"; sessionId?: string }, registry?: ToolRegistry) {
  if (!registry) throw new Error("runtime_recovery requires registry");
  const action = input.action ?? "report";
  if (action === "report") {
    return buildRecoveryReport(registry);
  }
  const result = await applyRecoveryAction(action === "inspect" ? "inspect" : action, input.sessionId);
  await persistRuntimeState(registry);
  return {
    ...result,
    recovery: buildRecoveryReport(registry),
  };
}
