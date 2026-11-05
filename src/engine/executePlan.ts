import { ToolRegistry } from "../core/toolRegistry.js";
import { ToolExecutionErrorClass, ErrorCode } from "../core/errorResponse.js";
import { createChildTraceContext, createRootTraceContext, TraceContext } from "../core/traceContext.js";
import { loadRuntimeConfig } from "../core/runtimeConfig.js";
import { globalObservability, BudgetConfig } from "../core/observability.js";
import { globalBudgetEngine } from "../core/budgetEngine.js";
import { globalAuditTrail } from "../core/auditTrail.js";

/**
 * Plan execution safety configuration.
 */
export interface PlanSafetyConfig {
  /** Maximum number of steps in a single plan execution */
  maxSteps: number;
  /** Maximum recursion depth for nested plan executions */
  maxDepth: number;
  /** Consecutive failures before auto-aborting plan */
  maxConsecutiveFailures: number;
  /** Whether to allow recursive plan invocations */
  allowRecursive: boolean;
}

function getDefaultSafety(): PlanSafetyConfig {
  const cfg = loadRuntimeConfig();
  return {
    maxSteps: cfg.policy.maxPlanSteps,
    maxDepth: cfg.policy.maxPlanDepth,
    maxConsecutiveFailures: cfg.policy.maxConsecutiveFailures,
    allowRecursive: false,
  };
}
interface PlanStep {
  tool: string;
  input?: unknown;
}
interface ExecutionPlan {
  steps?: PlanStep[];
}

/**
 * Execute a plan through ToolRegistry.
 * Single execution path with schema validation, timeout, audit logging.
 * Enforces plan safety limits: max steps, max depth, recursion detection,
 * consecutive failure cutoff.
 *
 * DEPTH TRACKING:
 * Uses ToolExecutionContext.metadata.depth (inherited through ToolRegistry.execute).
 * NEVER use module-level globals for depth — they are not concurrency-safe.
 * Two simultaneous executePlan calls would corrupt a shared counter.
 * Instead, depth is passed through the execution context chain:
 *   executePlan(depth=0) → registry.execute(depth=0) → createExecutionContext(depth=0+1=1)
 *   → tool calls registry.execute(depth=1) → createExecutionContext(depth=1+1=2)
 */
export async function executePlan(
  registry: ToolRegistry,
  plan: unknown,
  safety: PlanSafetyConfig = getDefaultSafety(),
  parentRequestId?: string,
  currentDepth: number = 0,
  parentTrace?: TraceContext,
  budget?: BudgetConfig
) {
  const planId = parentRequestId ?? `plan-${Date.now()}`;
  globalAuditTrail.record("plan", "start", { planId, stepCount: typeof plan === "object" && plan && Array.isArray((plan as ExecutionPlan).steps) ? (plan as ExecutionPlan).steps?.length ?? 0 : 0 });
  globalObservability.startTimeline(planId, "execute_plan");
  if (budget) {
    globalBudgetEngine.applyBudget(budget, planId);
  }

  // Recursion depth checks use context-inherited depth
  if (currentDepth > safety.maxDepth) {
    globalObservability.endTimeline("failed");
    globalAuditTrail.record("plan", "fail", { planId, reason: "max_depth", currentDepth, maxDepth: safety.maxDepth });
    throw new ToolExecutionErrorClass(
      ErrorCode.PLAN_LIMIT_EXCEEDED,
      `Plan execution exceeded max depth of ${safety.maxDepth}`,
      { retryable: false, details: { maxDepth: safety.maxDepth, currentDepth } }
    );
  }

  const steps = (
    typeof plan === "object" &&
    plan !== null &&
    "steps" in plan &&
    Array.isArray((plan as ExecutionPlan).steps)
  )
    ? (plan as ExecutionPlan).steps ?? []
    : [];
  if (steps.length === 0) {
    globalObservability.endTimeline("completed");
    globalAuditTrail.record("plan", "complete", { planId, stepCount: 0 });
    return [];
  }

  // Max steps guard
  if (steps.length > safety.maxSteps) {
    globalObservability.endTimeline("failed");
    globalAuditTrail.record("plan", "fail", { planId, reason: "max_steps", maxSteps: safety.maxSteps, requested: steps.length });
    throw new ToolExecutionErrorClass(
      ErrorCode.PLAN_LIMIT_EXCEEDED,
      `Plan exceeds max steps: ${steps.length} > ${safety.maxSteps}`,
      { retryable: false, details: { maxSteps: safety.maxSteps, requested: steps.length } }
    );
  }

  // Recursion detection — deduplicate tool names
  if (!safety.allowRecursive) {
    const toolNames = steps.map((s) => s.tool).filter(Boolean);
    const unique = new Set(toolNames);
    if (unique.size === 1 && toolNames.length > 1 && toolNames[0] === "execute_plan") {
      globalObservability.endTimeline("failed");
      globalAuditTrail.record("plan", "fail", { planId, reason: "recursive" });
      throw new ToolExecutionErrorClass(
        ErrorCode.PLAN_LIMIT_EXCEEDED,
        "Recursive plan execution detected and blocked",
        { retryable: false, details: { tool: toolNames[0], count: toolNames.length } }
      );
    }
  }

  const results: Array<{ step: PlanStep; output?: unknown; error?: string; status: string }> = [];
  let consecutiveFailures = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    globalAuditTrail.record("plan", "step_start", { planId, index: i, tool: step.tool });
    const stepStart = Date.now();
    const stepTrace = parentTrace
      ? createChildTraceContext(parentTrace, { toolName: step.tool, requestId: parentRequestId ?? parentTrace.requestId, parentRequestId })
      : createRootTraceContext({ toolName: step.tool, requestId: parentRequestId, parentRequestId });

    try {
      // Pass depth(currentDepth + 1) through registry.execute
      // The registry's createExecutionContext will increment to currentDepth + 2
      // which is correct for nested tool calls within plan steps
      const output = await registry.execute(
        step.tool,
        step.input || {},
        parentRequestId,
        currentDepth,  // depth context inherited
        undefined,     // parentSignal — can be wired later via AbortController
        stepTrace
      );
      results.push({ step, output, status: "success" });
      globalObservability.recordTimelineSpan({
        type: "step",
        name: `step_${i + 1}`,
        startTime: stepStart,
        endTime: Date.now(),
        success: true,
      });
      globalAuditTrail.record("plan", "step_success", { planId, index: i, tool: step.tool });
      consecutiveFailures = 0; // reset on success
    } catch (e: unknown) {
      consecutiveFailures++;
      const message = e instanceof Error ? e.message : String(e);

      results.push({ step, error: message, status: "error" });
      globalObservability.recordTimelineSpan({
        type: "step",
        name: `step_${i + 1}`,
        startTime: stepStart,
        endTime: Date.now(),
        success: false,
      });
      globalAuditTrail.record("plan", "step_fail", { planId, index: i, tool: step.tool });

      // Consecutive failure cutoff
      if (consecutiveFailures >= safety.maxConsecutiveFailures) {
        globalObservability.endTimeline("failed");
        globalAuditTrail.record("plan", "fail", { planId, reason: "consecutive_failures", consecutiveFailures });
        throw new ToolExecutionErrorClass(
          ErrorCode.PLAN_LIMIT_EXCEEDED,
          `Plan aborted: ${consecutiveFailures} consecutive failures at step ${i}`,
          {
            retryable: false,
            details: {
              consecutiveFailures,
              lastTool: step.tool,
              lastError: message,
              completedSteps: results.length,
            },
          }
        );
      }
    }
  }

  globalObservability.endTimeline("completed");
  globalAuditTrail.record("plan", "complete", { planId, stepCount: steps.length });
  return results;
}
