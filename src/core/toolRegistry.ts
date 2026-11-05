import { z } from "zod";
import fs from "fs";
import path from "path";
import { globalToolLogger } from "./toolLogger.js";
import { withTimeout, getToolTimeout, TimeoutError } from "./timeout.js";
import {
  ToolExecutionErrorClass,
  ErrorCode,
} from "./errorResponse.js";
import { createExecutionContext, ToolExecutionContext } from "./executionContext.js";
import { PolicyEngine, PolicyTier, ToolPolicyConfig } from "./policyEngine.js";
import { ApprovalEngine } from "./approvalEngine.js";
import { createChildTraceContext, createRootTraceContext, TraceContext } from "./traceContext.js";
import { globalObservability, ObservabilitySnapshot } from "./observability.js";
import { globalBudgetEngine } from "./budgetEngine.js";
import { globalCacheEngine } from "./cacheEngine.js";
import { loadRuntimeConfig } from "./runtimeConfig.js";
import { globalSessionCoordinator } from "./sessionCoordinator.js";
import { persistRuntimeState } from "./runtimePersistence.js";
import { globalAuditTrail } from "./auditTrail.js";

type ToolHandler = (input: unknown, context?: ToolExecutionContext) => Promise<unknown>;

/**
 * Public tool metadata — NO handler reference.
 * Consumers must use ToolRegistry.execute() to invoke tools.
 * Direct handler access is a bypass and is BLOCKED.
 */
export interface ToolDefinition {
  name: string;
  /** Schema is available for discovery */
  schema?: z.ZodType<unknown>;
  description?: string;
  policy?: ToolPolicyConfig;
}

/**
 * Per-tool latency distribution tracking.
 * min / max / p50 / p95 / rolling window — averages hide spikes.
 * Uses a rolling array (maxSamples) bounded by MAX_LATENCY_SAMPLES.
 */
export interface PerToolLatency {
  executions: number;
  errors: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  minMs: number;
  maxMs: number;
  recentSamples: number[];
  maxSamples: number;
}

/**
 * Registry-level observability counters.
 */
export interface RegistryStats {
  totalExecutions: number;
  validationFailures: number;
  deniedExecutions: number;
  timeoutCounts: number;
  cancellationCounts: number;
  policyDeniedCounts: number;
  perTool: Record<string, PerToolLatency>;
  latencyBuckets: Record<string, number>;
}

/**
 * Immutable health snapshot — decoupled from internal metric shapes.
 */
export interface HealthSnapshot {
  status: "healthy" | "degraded" | "unhealthy";
  totalTools: number;
  healthyTools: number;
  unclassifiedTools: number;
  schematizedTools: number;
  totalExecutions: number;
  totalErrors: number;
  timeoutCounts: number;
  cancellationCounts: number;
  policyDeniedCounts: number;
  successRate: string;
  latencyBuckets: Record<string, number>;
  issues: string[];
  errorCountsByCode: Record<string, number>;
  providerFailures: number;
  recentTraceSummaries: ObservabilitySnapshot["recentTraces"];
}

const MAX_LATENCY_SAMPLES = 1000;
const CACHEABLE_READ_TOOLS = new Set([
  "code_map",
  "symbol_graph",
  "references",
  "project_tree",
  "import_graph",
  "workspace_config",
  "metrics_snapshot",
]);
const MUTATION_TOOLS = new Set([
  "write_file",
  "delete_file",
  "move_file",
  "copy_file",
  "apply_patch",
  "unified_patch",
]);

export class ToolRegistry {
  private static instanceCounter = 0;
  public readonly instanceId: string;
  /** Private — raw handlers are NOT accessible from outside. Use execute() only. */
  private tools: Record<string, ToolHandler> = {};
  private schemas: Record<string, z.ZodType<unknown>> = {};
  private descriptions: Record<string, string> = {};
  private enableTimeouts: boolean = true;

  private policyEngine: PolicyEngine;
  private approvalEngine: ApprovalEngine;

  private toolPolicies: Record<string, PolicyTier> = {};

  private stats: RegistryStats = {
    totalExecutions: 0,
    validationFailures: 0,
    deniedExecutions: 0,
    timeoutCounts: 0,
    cancellationCounts: 0,
    policyDeniedCounts: 0,
    perTool: {},
    latencyBuckets: { "0-100ms": 0, "100-500ms": 0, "500-2000ms": 0, "2000ms+": 0 },
  };

  constructor(policyEngine?: PolicyEngine, approvalEngine?: ApprovalEngine) {
    ToolRegistry.instanceCounter += 1;
    this.instanceId = `registry-${ToolRegistry.instanceCounter}`;
    this.policyEngine = policyEngine ?? new PolicyEngine();
    this.approvalEngine = approvalEngine ?? new ApprovalEngine();
  }

  /**
   * Register a tool with registry.
   * Policy tier is read from the policy engine at registration time.
   * If no policy exists, this tool is effectively unclassified and will be
   * denied at execution time by the policy engine (default deny).
   */
  register<TInput = unknown, TOutput = unknown>(
    name: string,
    handler: (input: TInput, context?: ToolExecutionContext) => Promise<TOutput>,
    schema?: z.ZodType<unknown>,
    description?: string
  ) {
    if (!name) throw new Error("Tool name is required");
    if (this.tools[name]) {
      throw new Error(`Tool already registered: ${name}`);
    }

    this.tools[name] = handler as ToolHandler;
    if (schema) this.schemas[name] = schema;
    if (description) this.descriptions[name] = description;

    // Read policy tier from policy engine
    const policy = this.policyEngine.getPolicy(name);
    if (policy) {
      this.toolPolicies[name] = policy.tier;
    }

    this.stats.perTool[name] = this.createDefaultPerTool();
  }

  private createDefaultPerTool(): PerToolLatency {
    return {
      executions: 0,
      errors: 0,
      totalLatencyMs: 0,
      avgLatencyMs: 0,
      minMs: Infinity,
      maxMs: -Infinity,
      recentSamples: [],
      maxSamples: MAX_LATENCY_SAMPLES,
    };
  }

  /**
   * Check if a tool is registered.
   * Does NOT return the handler — use execute() to invoke.
   */
  has(name: string): boolean {
    return !!this.tools[name];
  }

  /**
   * List registered tool names.
   */
  list(): string[] {
    return Object.keys(this.tools);
  }

  /**
   * Get schema for a tool (inspection/validation only).
   */
  getSchema(name: string): z.ZodType<unknown> | undefined {
    return this.schemas[name];
  }

  /**
   * Get description for a tool.
   */
  getDescription(name: string): string | undefined {
    return this.descriptions[name];
  }

  /**
   * Get the policy tier for a tool.
   */
  getPolicyTier(name: string): PolicyTier | undefined {
    return this.toolPolicies[name];
  }

  /**
   * List all tool definitions — metadata only, NO handler references.
   * Consumers can discover available tools but CANNOT invoke them directly.
   * All execution must go through ToolRegistry.execute().
   */
  listDefinitions(): ToolDefinition[] {
    const tools = this.list();
    return tools.map(name => ({
      name,
      schema: this.schemas[name],
      description: this.descriptions[name],
      policy: this.policyEngine.getPolicy(name),
    }));
  }

  /**
   * Copy all tool registrations from another registry into this one.
   * Uses private state access — no public handler exposure needed.
   * Only works for initial setup/loading; not for runtime dynamic registration.
   */
  importFromRegistry(other: ToolRegistry): void {
    for (const [name, handler] of Object.entries(other.tools)) {
      if (this.tools[name]) continue; // skip duplicates
      this.tools[name] = handler;
      if (other.schemas[name]) this.schemas[name] = other.schemas[name];
      if (other.descriptions[name]) this.descriptions[name] = other.descriptions[name];
      if (other.toolPolicies[name]) this.toolPolicies[name] = other.toolPolicies[name];
      this.stats.perTool[name] = this.createDefaultPerTool();
    }
  }

  /**
   * Revalidate a resolved path immediately before critical write/delete.
   * Mitigates TOCTOU races.
   */
  revalidateSafePath(resolvedPath: string, allowedBase: string): void {
    const t0 = Date.now();
    let ok = false;
    try {
    const base = path.resolve(allowedBase);
    const realPath = fs.realpathSync(resolvedPath);
    const relative = path.relative(base, realPath.startsWith(resolvedPath) ? realPath : resolvedPath);
    if (relative.startsWith("..")) {
      throw new ToolExecutionErrorClass(ErrorCode.PATH_DENIED, "Path is outside allowed workspace (revalidation failed)", { tool: "pathSafety" });
    }
    ok = true;
    } finally {
      globalObservability.recordPathSafetyCheck(Date.now() - t0, ok);
    }
  }

  /**
   * Get engines for injection into tools.
   */
  getPolicyEngine(): PolicyEngine {
    return this.policyEngine;
  }

  getApprovalEngine(): ApprovalEngine {
    return this.approvalEngine;
  }

  /**
   * Execute tool with:
   * 1. Schema validation (if defined)
   * 2. Policy evaluation (approval check)
   * 3. Execution with timeout + cancellation + audit logging
   *
   * This is the SINGLE entry point for all tool execution.
   * All flows (MCP, agent loop, plan executor) must funnel through here.
   *
   * @param name - Tool name to execute
   * @param input - Tool input parameters
   * @param parentRequestId - Parent request ID for correlation chain
   * @param parentDepth - Parent execution depth (for plan nesting detection)
   * @param parentSignal - Parent AbortSignal for cancellation propagation
   */
  async execute(
    name: string,
    input: unknown,
    parentRequestId?: string,
    parentDepth: number = 0,
    parentSignal?: AbortSignal,
    parentTrace?: TraceContext
  ) {
    const startTime = Date.now();
    const toolSpanStart = startTime;
    const workspaceRoot = loadRuntimeConfig().workspaceRoot;
    this.stats.totalExecutions++;

    // Initialize per-tool stats if missing
    if (!this.stats.perTool[name]) {
      this.stats.perTool[name] = this.createDefaultPerTool();
    }
    this.stats.perTool[name].executions++;

    // ===== STEP 1: Apply schema validation if defined =====
    const schema = this.schemas[name];
    if (schema) {
      const result = schema.safeParse(input);
      if (!result.success) {
        this.stats.validationFailures++;
        this.stats.perTool[name].errors++;
        const formatted = result.error.issues.map(i =>
          `${i.path.join(".")}: ${i.message}`
        ).join("; ");
        throw new ToolExecutionErrorClass(
          ErrorCode.VALIDATION_FAILED,
          `Input validation failed: ${formatted}`,
          { tool: name, details: { issues: result.error.issues } }
        );
      }
    }

    // ===== STEP 2: Resolve policy tier =====
    const policy = this.policyEngine.getPolicy(name);
    const policyTier = policy?.tier ?? PolicyTier.DANGEROUS; // unknown → dangerous
    const canUseCache = CACHEABLE_READ_TOOLS.has(name) && policyTier === PolicyTier.READ_ONLY;
    const cacheKey = canUseCache ? globalCacheEngine.makeKey(name, input, workspaceRoot) : "";

    // ===== STEP 3: Policy evaluation (approval check) =====
    // The parentRequestId param from execute IS this execution's own requestId.
    // Use it as the execution identity, NOT as a parent requestId for inheritance.
    // Child executions pass their own parent's requestId for inheritance chain matching.
    const execRequestId = parentRequestId ?? "root";
    const sessionId = globalSessionCoordinator.getIdentity().sessionId;
    const hasApproval = this.approvalEngine.hasApproval(
      execRequestId,
      name,
      policyTier,
      // No parentRequestId — this IS the top-level execution scope
      // Child calls inherit via the exec context's parentRequestId
      undefined,
      sessionId
    );

    const evaluation = this.policyEngine.evaluate(name, hasApproval);

    if (!evaluation.allowed) {
      const denialTrace = parentTrace
        ? createChildTraceContext(parentTrace, { requestId: parentRequestId ?? "root", parentRequestId, toolName: name })
        : createRootTraceContext({ requestId: parentRequestId ?? "root", parentRequestId, toolName: name });

      this.stats.policyDeniedCounts++;
      this.stats.deniedExecutions++;
      this.stats.perTool[name].errors++;

      // If requires approval, create a pending approval request automatically
      let pendingApproval: ReturnType<ApprovalEngine["request"]> | null = null;
      if (evaluation.requiresApproval) {
        pendingApproval = this.approvalEngine.request(
          parentRequestId ?? "root",
          name,
          policyTier,
          input,
          parentRequestId,
          sessionId
        );
        console.error(`[AlfaDev][Approval] pending approval created: ${pendingApproval.id} tool=${name} tier=${policyTier} requestId=${pendingApproval.requestId} registry=${this.instanceId}`);
        try {
          await persistRuntimeState(this);
        } catch {
          // Persistence failures are non-fatal for approval creation.
        }
      }

      // Audit denial before throwing
      globalToolLogger.startExecution(
        "policy_denial",
        JSON.stringify({
          toolName: name,
          tier: evaluation.tier,
          reason: evaluation.denialReason,
          requestId: parentRequestId,
          hasApproval,
        }).length,
        parentRequestId,
        undefined,
        denialTrace
      );
      globalObservability.recordToolExecution({
        toolName: name,
        trace: denialTrace,
        success: false,
        durationMs: 0,
        errorCode: ErrorCode.POLICY_DENIED,
      });

      // Handler is NEVER called — blocked before execution
      throw new ToolExecutionErrorClass(
        ErrorCode.POLICY_DENIED,
        evaluation.denialReason ?? `Policy denied execution of '${name}'`,
        {
          tool: name,
          retryable: false,
          details: {
            policyTier: evaluation.tier,
            requiresApproval: evaluation.requiresApproval,
            denialReason: evaluation.denialReason,
            hasApproval,
            approvalRequired: evaluation.requiresApproval,
            approvalId: pendingApproval?.id ?? null,
            approvalRequestId: pendingApproval?.requestId ?? (parentRequestId ?? "root"),
            approvalToolName: pendingApproval?.toolName ?? name,
            approvalTier: pendingApproval?.policyTier ?? evaluation.tier,
            approvalReason: pendingApproval?.reason ?? evaluation.denialReason ?? "Approval required before execution",
          },
        }
      );
    }

    // ===== STEP 4: Validate tool exists (only reached if policy allowed) =====
    if (!this.has(name)) {
      this.stats.deniedExecutions++;
      throw new ToolExecutionErrorClass(ErrorCode.TOOL_NOT_FOUND, `Tool not found: ${name}`, { tool: name });
    }

    // ===== STEP 5: Create execution context =====
    const timeoutMs = getToolTimeout(name);
    const { context, controller } = createExecutionContext(
      name,
      timeoutMs,
      policyTier,
      parentRequestId,
      parentDepth,
      parentSignal,
      undefined,
      parentTrace
    );

    // Set approval state in context for tool awareness
    context.approval.isApproved = true;
    const budgetScope = parentRequestId ?? context.requestId;
    globalBudgetEngine.countToolCall(budgetScope, undefined);
    let mutationLockAcquired = false;
    if (MUTATION_TOOLS.has(name)) {
      globalSessionCoordinator.acquireMutationLock(name);
      mutationLockAcquired = true;
      globalBudgetEngine.countMutationOperation(budgetScope, undefined, name);
    }

    // ===== STEP 6: Audit log execution start =====
    // (STEP 7 is the handler execution inside try block)
    const logTicket = globalToolLogger.startExecution(
      name,
      JSON.stringify(input).length,
      context.requestId,
      parentRequestId,
      context.trace
    );

    try {
      globalAuditTrail.record("tool", "start", { toolName: name, requestId: context.requestId, sessionId });
      if (canUseCache) {
        const cached = globalCacheEngine.get(cacheKey);
        if (cached !== undefined) {
          const durationMs = Date.now() - startTime;
          this.recordLatency(name, durationMs);
          globalObservability.recordToolExecution({ toolName: name, trace: context.trace, success: true, durationMs });
          return cached;
        }
      }

      // ===== STEP 7: Execute handler via private handler reference =====
      // Only execute() can access the handler — no other code path.
      const handler = this.tools[name];
      let resultPromise = handler(input, context);

      // Apply timeout with cancellation support
      if (this.enableTimeouts) {
        resultPromise = withTimeout(
          resultPromise,
          timeoutMs,
          name,
          context.signal
        );
      }

      const result = await resultPromise;

      // Audit log: success
      const outputSize = JSON.stringify(result).length;
      globalToolLogger.endExecution(logTicket, true, outputSize, undefined, undefined, context.requestId, parentRequestId, context.trace);

      // Track latency
      const durationMs = Date.now() - startTime;
      this.recordLatency(name, durationMs);
      globalObservability.recordToolExecution({ toolName: name, trace: context.trace, success: true, durationMs });
      globalObservability.recordTimelineSpan({
        type: "tool",
        name,
        toolName: name,
        startTime: toolSpanStart,
        endTime: Date.now(),
        success: true,
      });

      if (canUseCache) {
        globalCacheEngine.set(cacheKey, result, name, workspaceRoot);
        globalBudgetEngine.checkCacheEntries(budgetScope, undefined, globalCacheEngine.entryCount());
      } else if (MUTATION_TOOLS.has(name)) {
        // Invalidate deterministic read-tool cache on successful mutations.
        globalCacheEngine.invalidateTools(Array.from(CACHEABLE_READ_TOOLS));
        await persistRuntimeState(this);
      }
      globalAuditTrail.record("tool", "success", { toolName: name, requestId: context.requestId, durationMs });

      return result;
    } catch (error: unknown) {
      const normalized = ToolExecutionErrorClass.from(error, { defaultTool: name });

      if (context.signal.aborted) {
        this.stats.cancellationCounts++;
        const cancelErr = new ToolExecutionErrorClass(ErrorCode.CANCELLED, `Tool '${name}' was cancelled`, { tool: name, retryable: false });
        this.stats.perTool[name].errors++;
        globalToolLogger.endExecution(logTicket, false, undefined, cancelErr.message, ErrorCode.CANCELLED, context.requestId, parentRequestId, context.trace);
        const durationMs = Date.now() - startTime;
        this.recordLatency(name, durationMs);
        globalObservability.recordToolExecution({ toolName: name, trace: context.trace, success: false, durationMs, errorCode: ErrorCode.CANCELLED });
        globalObservability.recordTimelineSpan({
          type: "tool",
          name,
          toolName: name,
          startTime: toolSpanStart,
          endTime: Date.now(),
          success: false,
          errorCode: ErrorCode.CANCELLED,
        });
        throw cancelErr;
      }

      if (error instanceof TimeoutError) {
        this.stats.timeoutCounts++;
        const timeoutErr = new ToolExecutionErrorClass(
          ErrorCode.EXECUTION_TIMEOUT,
          `Tool '${name}' exceeded timeout of ${timeoutMs}ms`,
          { tool: name, retryable: false }
        );
        this.stats.perTool[name].errors++;
        globalToolLogger.endExecution(logTicket, false, undefined, timeoutErr.message, ErrorCode.EXECUTION_TIMEOUT, context.requestId, parentRequestId, context.trace);
        const durationMs = Date.now() - startTime;
        this.recordLatency(name, durationMs);
        globalObservability.recordToolExecution({ toolName: name, trace: context.trace, success: false, durationMs, errorCode: ErrorCode.EXECUTION_TIMEOUT });
        globalObservability.recordTimelineSpan({
          type: "tool",
          name,
          toolName: name,
          startTime: toolSpanStart,
          endTime: Date.now(),
          success: false,
          errorCode: ErrorCode.EXECUTION_TIMEOUT,
        });
        throw timeoutErr;
      }

      this.stats.perTool[name].errors++;
      globalAuditTrail.record("tool", "failure", { toolName: name, requestId: context.requestId, errorCode: normalized.code });
      globalToolLogger.endExecution(logTicket, false, undefined, normalized.message, normalized.code, context.requestId, parentRequestId, context.trace);
      const durationMs = Date.now() - startTime;
      this.recordLatency(name, durationMs);
      globalObservability.recordToolExecution({ toolName: name, trace: context.trace, success: false, durationMs, errorCode: normalized.code });
      globalObservability.recordTimelineSpan({
        type: "tool",
        name,
        toolName: name,
        startTime: toolSpanStart,
        endTime: Date.now(),
        success: false,
        errorCode: normalized.code,
      });
      throw normalized;
    } finally {
      if (mutationLockAcquired) {
        globalSessionCoordinator.releaseMutationLock(name);
      }
      controller.abort();
    }
  }

  private recordLatency(name: string, latencyMs: number): void {
    const p = this.stats.perTool[name];
    if (!p) return;
    p.totalLatencyMs += latencyMs;
    p.avgLatencyMs = p.totalLatencyMs / p.executions;
    if (latencyMs < p.minMs) p.minMs = latencyMs;
    if (latencyMs > p.maxMs) p.maxMs = latencyMs;
    p.recentSamples.push(latencyMs);
    if (p.recentSamples.length > p.maxSamples) {
      p.recentSamples = p.recentSamples.slice(p.recentSamples.length - p.maxSamples);
    }
    if (latencyMs < 100) this.stats.latencyBuckets["0-100ms"]++;
    else if (latencyMs < 500) this.stats.latencyBuckets["100-500ms"]++;
    else if (latencyMs < 2000) this.stats.latencyBuckets["500-2000ms"]++;
    else this.stats.latencyBuckets["2000ms+"]++;
  }

  private percentile(samples: number[], pct: number): number {
    if (samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const idx = Math.ceil((pct / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  }

  getToolLatencyPercentiles(name: string): { minMs: number; maxMs: number; avgMs: number; p50Ms: number; p95Ms: number } | null {
    const p = this.stats.perTool[name];
    if (!p || p.recentSamples.length === 0) return null;
    return { minMs: p.minMs, maxMs: p.maxMs, avgMs: p.avgLatencyMs, p50Ms: this.percentile(p.recentSamples, 50), p95Ms: this.percentile(p.recentSamples, 95) };
  }

  getStats(): RegistryStats {
    return { ...this.stats };
  }

  getToolStats(name: string): PerToolLatency | null {
    return this.stats.perTool[name]
      ? { ...this.stats.perTool[name], recentSamples: [] }
      : null;
  }

  /**
   * Get an immutable health snapshot — decoupled from internal metric shapes.
   * Reports unclassified tools as issues (classification required for health).
   */
  getHealthSnapshot(): HealthSnapshot {
    const issues: string[] = [];
    let healthyTools = 0;
    let unclassifiedTools = 0;
    const toolNames = this.list();

    for (const toolName of toolNames) {
      const policy = this.policyEngine.getPolicy(toolName);
      const handler = this.tools[toolName];

      if (!handler) {
        issues.push(`Tool '${toolName}' has no registered handler`);
        continue;
      }

      if (typeof handler !== "function") {
        issues.push(`Tool '${toolName}' is not callable`);
        continue;
      }

      // Classification required for health
      if (!policy) {
        unclassifiedTools++;
        issues.push(`Tool '${toolName}' has no policy classification — default deny. Register a policy tier.`);
        continue;
      }

      healthyTools++;
    }

    const totalErrors = this.stats.validationFailures + this.stats.deniedExecutions + this.stats.timeoutCounts + this.stats.cancellationCounts + this.stats.policyDeniedCounts;
    const successExecutions = Math.max(0, this.stats.totalExecutions - totalErrors);

    const status =
      issues.length === 0
        ? "healthy"
        : issues.length < toolNames.length * 0.1
          ? "degraded"
          : "unhealthy";

    const obs = globalObservability.getSnapshot();
    return {
      status,
      totalTools: toolNames.length,
      healthyTools,
      unclassifiedTools,
      schematizedTools: Object.keys(this.schemas).length,
      totalExecutions: this.stats.totalExecutions,
      totalErrors,
      timeoutCounts: this.stats.timeoutCounts,
      cancellationCounts: this.stats.cancellationCounts,
      policyDeniedCounts: this.stats.policyDeniedCounts,
      successRate:
        this.stats.totalExecutions > 0
          ? ((successExecutions / this.stats.totalExecutions) * 100).toFixed(2) + "%"
          : "N/A",
      latencyBuckets: { ...this.stats.latencyBuckets },
      issues,
      errorCountsByCode: obs.errorCountsByCode,
      providerFailures: obs.providerFailures,
      recentTraceSummaries: obs.recentTraces,
    };
  }

  setTimeouts(enabled: boolean) {
    this.enableTimeouts = enabled;
  }

  getLogs() {
    return globalToolLogger.getLogs();
  }

  clearLogs() {
    globalToolLogger.clear();
  }

  getObservabilitySnapshot(): ObservabilitySnapshot {
    return globalObservability.getSnapshot();
  }

  resetStats() {
    this.stats = {
      totalExecutions: 0,
      validationFailures: 0,
      deniedExecutions: 0,
      timeoutCounts: 0,
      cancellationCounts: 0,
      policyDeniedCounts: 0,
      perTool: {},
      latencyBuckets: { "0-100ms": 0, "100-500ms": 0, "500-2000ms": 0, "2000ms+": 0 },
    };
    globalObservability.reset();
    globalCacheEngine.reset();
  }

  async healthCheck(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    totalTools: number;
    healthyTools: number;
    schematizedTools: number;
    issues: string[];
  }> {
    const snapshot = this.getHealthSnapshot();
    return {
      status: snapshot.status,
      totalTools: snapshot.totalTools,
      healthyTools: snapshot.healthyTools,
      schematizedTools: snapshot.schematizedTools,
      issues: snapshot.issues,
    };
  }
}
