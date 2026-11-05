import { AgentCore } from "./agentCore.js";
import { ToolRegistry } from "../core/toolRegistry.js";
import { createChildTraceContext, createRootTraceContext } from "../core/traceContext.js";

/**
 * Run an agent goal using the ToolRegistry path.
 * Replaces the old ToolExecutor-based path (now deprecated).
 * Single validation+approval+audit flow via ToolRegistry.execute().
 */
export async function runAgent(goal: string, registry: ToolRegistry) {
  const core = new AgentCore();
  const rootTrace = createRootTraceContext({ toolName: "agent_loop" });

  // Generate a plan using the agent core logic
  const plan = await core.plan(goal);

  // Execute plan steps through ToolRegistry (single execution path)
  // This ensures schema validation, timeout, audit logging, and
  // future approval/policy interception all happen consistently.
  const results: Array<{ step: string; status: string; output?: unknown; error?: string }> = [];

  for (const step of plan) {
    try {
      const stepTrace = createChildTraceContext(rootTrace, { toolName: step.tool });
      const output = await registry.execute(step.tool, step.input || {}, rootTrace.requestId, 0, undefined, stepTrace);
      results.push({ step: step.tool, status: "success", output });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      results.push({ step: step.tool, status: "error", error: message });
    }
  }

  return {
    goal,
    steps: plan.map(s => s.tool),
    result: results,
  };
}
