/**
 * P6.1 — Advanced Observability & Metrics
 *
 * Expands observability with:
 * - Token usage and cost estimation
 * - Budget enforcement (max tokens, max cost, max tool calls)
 * - Plan execution timelines with structured spans
 * - Latency percentiles (p50/p95/p99)
 * - Safe metrics snapshot (no secret leakage)
 */

import type { TraceContext } from "./traceContext.js";
import { loadRuntimeConfig } from "./runtimeConfig.js";
import { globalCacheEngine } from "./cacheEngine.js";

export interface TraceSummary extends TraceContext {
  timestamp: string;
  status: "success" | "failure";
  durationMs?: number;
  errorCode?: string;
}

export interface ExecutionTimeline {
  planId: string;
  planName?: string;
  startTime: number;
  endTime?: number;
  status: "running" | "completed" | "failed" | "rolled_back";
  totalCostUsd?: number;
  totalTokens?: number;
  spans: TimelineSpan[];
}

export interface TimelineSpan {
  spanId: string;
  parentSpanId?: string;
  type: "plan" | "step" | "tool" | "provider" | "rollback" | "checkpoint";
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  success: boolean;
  errorCode?: string;
  toolName?: string;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
}

export interface ExecutionCost {
  providerRequests: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  estimatedCostUsd: number;
  perPlan: Record<string, {
    providerRequests: number;
    estimatedTotalTokens: number;
    estimatedCostUsd: number;
  }>;
  modelBreakdown: Record<string, {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
}

export interface BudgetConfig {
  maxTokensPerExecution?: number;
  maxCostUsdPerExecution?: number;
  maxToolCallsPerExecution?: number;
  maxProviderCallsPerExecution?: number;
  maxCommandExecutionsPerExecution?: number;
  maxMutationOperationsPerExecution?: number;
  maxCacheEntries?: number;
}

export interface BudgetViolation {
  type: "maxTokens" | "maxCost" | "maxToolCalls" | "maxProviderCalls" | "maxCommandExecutions" | "maxMutationOperations" | "maxCacheEntries";
  limit: number;
  actual: number;
  requestId?: string;
  toolName?: string;
  provider?: string;
}

export interface QuotaCheck {
  type: BudgetViolation["type"];
  requestId?: string;
  passed: boolean;
  actual: number;
  limit?: number;
  toolName?: string;
  provider?: string;
  timestamp: number;
}

export interface LatencyPercentiles {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  count: number;
}

export interface ToolLatencyMetrics extends LatencyPercentiles {
  toolName: string;
  calls: number;
  success: number;
  failure: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
}

export interface ProviderLatencyMetrics extends LatencyPercentiles {
  provider: string;
  calls: number;
  success: number;
  failure: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
}

export interface TopSlowTool {
  toolName: string;
  p99Ms: number;
  avgMs: number;
  calls: number;
}

export interface PerformanceWarning {
  type: "tool_latency" | "provider_latency" | "plan_duration" | "excessive_tool_calls";
  name: string;
  value: number;
  threshold: number;
  timestamp: number;
}

export interface ProfilingSnapshot {
  slowestTools: TopSlowTool[];
  slowestProviderCalls: Array<{ provider: string; p99Ms: number; avgMs: number; calls: number }>;
  slowestPlanSteps: Array<{ stepName: string; p99Ms: number; avgMs: number; calls: number }>;
  commandLatency: LatencyPercentiles & { calls: number; failures: number };
  fileOperationLatency: LatencyPercentiles & { calls: number; failures: number };
  pathSafetyLatency: LatencyPercentiles & { calls: number; failures: number };
  protectedPathLatency: LatencyPercentiles & { calls: number; failures: number };
  highErrorTools: Array<{ toolName: string; failures: number; calls: number; failureRate: number }>;
  highDenialTools: Array<{ toolName: string; denials: number }>;
  warnings: PerformanceWarning[];
}

const MODEL_TOKEN_RATES: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4-turbo": { inputPer1M: 10, outputPer1M: 30 },
  "gpt-3.5-turbo": { inputPer1M: 0.5, outputPer1M: 1.5 },
  "claude-3-5-sonnet": { inputPer1M: 3, outputPer1M: 15 },
  "claude-3-5-haiku": { inputPer1M: 0.8, outputPer1M: 4 },
  "gemini-1.5-pro": { inputPer1M: 1.25, outputPer1M: 5 },
  "gemini-1.5-flash": { inputPer1M: 0.035, outputPer1M: 0.14 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = MODEL_TOKEN_RATES[model] ?? { inputPer1M: 1, outputPer1M: 2 };
  const inputCost = (inputTokens / 1_000_000) * rates.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * rates.outputPer1M;
  return inputCost + outputCost;
}

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

export interface ObservabilitySnapshot {
  runtimeStatus: "healthy" | "degraded" | "unhealthy";
  totalExecutions: number;
  errorCountsByCode: Record<string, number>;
  policyDenials: number;
  providerFailures: number;
  latencyBuckets: Record<string, number>;
  budgetViolations: BudgetViolation[];
  cost: ExecutionCost;
  toolLatencyPercentiles: ToolLatencyMetrics[];
  providerLatencyPercentiles: ProviderLatencyMetrics[];
  planLatencyPercentiles: LatencyPercentiles;
  topSlowTools: TopSlowTool[];
  profiling: ProfilingSnapshot;
  cache: {
    entries: number;
    maxEntries: number;
    ttlMs: number;
    hitRatio: number;
    hits: number;
    misses: number;
    evictions: number;
    invalidations: number;
  };
  quota: {
    checks: number;
    violations: number;
    recentChecks: QuotaCheck[];
  };
  activeTraces: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  failureRate: number;
  toolMetrics: Record<string, {
    calls: number;
    success: number;
    failure: number;
    totalLatencyMs: number;
    avgLatencyMs: number;
  }>;
  providerMetrics: Record<string, {
    calls: number;
    success: number;
    failure: number;
    totalLatencyMs: number;
    avgLatencyMs: number;
    errorCodeCounts: Record<string, number>;
    modelUsage: Record<string, number>;
    totalCostUsd: number;
    totalTokens: number;
  }>;
  recentTraces: TraceSummary[];
  timelines: ExecutionTimeline[];
  safeForDisplay: boolean;
}

const MAX_TIMELINE_SPANS = 500;
const MAX_TIMELINES = 50;
const MAX_RECENT_TRACES = 100;
const MAX_SLOW_TOOLS = 10;
const MAX_LATENCY_SAMPLES = 1000;
const MAX_WARNINGS = 200;

const PERF_WARN_THRESHOLDS = {
  toolLatencyMs: 1500,
  providerLatencyMs: 3000,
  planDurationMs: 5000,
  excessiveToolCalls: 40,
};

class ObservabilityStore {
  private errorCountsByCode: Record<string, number> = {};
  private toolMetrics: ObservabilitySnapshot["toolMetrics"] = {};
  private providerMetrics: ObservabilitySnapshot["providerMetrics"] = {};
  private recentTraces: TraceSummary[] = [];
  private latencyBuckets: Record<string, number> = { "0-100ms": 0, "100-500ms": 0, "500-2000ms": 0, "2000ms+": 0 };
  private totalExecutions = 0;
  private policyDenials = 0;
  private providerFailures = 0;
  private budgetViolations: BudgetViolation[] = [];
  private timelines: ExecutionTimeline[] = [];

  private toolLatencySamples: Record<string, number[]> = {};
  private providerLatencySamples: Record<string, number[]> = {};
  private planLatencySamples: number[] = [];
  private stepLatencySamples: Record<string, number[]> = {};
  private commandLatencySamples: number[] = [];
  private fileOpLatencySamples: number[] = [];
  private pathSafetyLatencySamples: number[] = [];
  private protectedPathLatencySamples: number[] = [];
  private commandCalls = 0;
  private commandFailures = 0;
  private fileOpCalls = 0;
  private fileOpFailures = 0;
  private pathSafetyCalls = 0;
  private pathSafetyFailures = 0;
  private protectedPathCalls = 0;
  private protectedPathFailures = 0;
  private toolDenialCounts: Record<string, number> = {};
  private warnings: PerformanceWarning[] = [];
  private quotaChecks: QuotaCheck[] = [];

  private cost: ExecutionCost = {
    providerRequests: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    estimatedTotalTokens: 0,
    estimatedCostUsd: 0,
    perPlan: {},
    modelBreakdown: {},
  };

  private readonly maxRecentTraces: number;
  private activeTimeline: ExecutionTimeline | null = null;
  private executionSuccessCount = 0;
  private executionFailureCount = 0;

  constructor() {
    this.maxRecentTraces = loadRuntimeConfig().observability.recentTraceLimit;
  }

  recordToolExecution(params: {
    toolName: string;
    trace: TraceContext;
    success: boolean;
    durationMs: number;
    errorCode?: string;
  }): void {
    this.totalExecutions++;
    if (params.success) this.executionSuccessCount++;
    else this.executionFailureCount++;
    if (!this.toolMetrics[params.toolName]) {
      this.toolMetrics[params.toolName] = { calls: 0, success: 0, failure: 0, totalLatencyMs: 0, avgLatencyMs: 0 };
    }
    if (!this.toolLatencySamples[params.toolName]) {
      this.toolLatencySamples[params.toolName] = [];
    }

    const tm = this.toolMetrics[params.toolName];
    tm.calls++;
    tm.totalLatencyMs += params.durationMs;
    tm.avgLatencyMs = tm.totalLatencyMs / tm.calls;
    if (params.success) tm.success++; else tm.failure++;

    this.toolLatencySamples[params.toolName].push(params.durationMs);
    if (this.toolLatencySamples[params.toolName].length > MAX_LATENCY_SAMPLES) {
      this.toolLatencySamples[params.toolName].shift();
    }

    this.recordLatency(params.durationMs);
    if (params.durationMs > PERF_WARN_THRESHOLDS.toolLatencyMs) {
      this.pushWarning({
        type: "tool_latency",
        name: params.toolName,
        value: params.durationMs,
        threshold: PERF_WARN_THRESHOLDS.toolLatencyMs,
        timestamp: Date.now(),
      });
    }
    if (params.errorCode) {
      this.errorCountsByCode[params.errorCode] = (this.errorCountsByCode[params.errorCode] ?? 0) + 1;
      if (params.errorCode === "POLICY_DENIED") this.policyDenials++;
      if (params.errorCode === "POLICY_DENIED") {
        this.toolDenialCounts[params.toolName] = (this.toolDenialCounts[params.toolName] ?? 0) + 1;
      }
    }

    this.pushTrace({
      ...params.trace,
      timestamp: new Date().toISOString(),
      status: params.success ? "success" : "failure",
      durationMs: params.durationMs,
      errorCode: params.errorCode,
      toolName: params.toolName,
    });
  }

  recordProviderCall(params: {
    provider: string;
    model?: string;
    trace?: TraceContext;
    success: boolean;
    durationMs: number;
    errorCode?: string;
    inputTokens?: number;
    outputTokens?: number;
    requestId?: string;
  }): void {
    if (!this.providerMetrics[params.provider]) {
      this.providerMetrics[params.provider] = {
        calls: 0, success: 0, failure: 0,
        totalLatencyMs: 0, avgLatencyMs: 0,
        errorCodeCounts: {}, modelUsage: {},
        totalCostUsd: 0, totalTokens: 0,
      };
    }
    if (!this.providerLatencySamples[params.provider]) {
      this.providerLatencySamples[params.provider] = [];
    }

    const pm = this.providerMetrics[params.provider];
    pm.calls++;
    pm.totalLatencyMs += params.durationMs;
    pm.avgLatencyMs = pm.totalLatencyMs / pm.calls;
    if (params.success) pm.success++; else pm.failure++;
    if (!params.success) this.providerFailures++;

    if (params.model) {
      pm.modelUsage[params.model] = (pm.modelUsage[params.model] ?? 0) + 1;

      const inputTokens = params.inputTokens ?? 0;
      const outputTokens = params.outputTokens ?? 0;
      const cost = estimateCost(params.model, inputTokens, outputTokens);

      if (!this.cost.modelBreakdown[params.model]) {
        this.cost.modelBreakdown[params.model] = { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
      }
      const mb = this.cost.modelBreakdown[params.model];
      mb.requests++;
      mb.inputTokens += inputTokens;
      mb.outputTokens += outputTokens;
      mb.costUsd += cost;

      pm.totalCostUsd += cost;
      pm.totalTokens += inputTokens + outputTokens;
      this.cost.estimatedInputTokens += inputTokens;
      this.cost.estimatedOutputTokens += outputTokens;
      this.cost.estimatedCostUsd += cost;
    }

    this.cost.providerRequests++;
    if (params.requestId) {
      if (!this.cost.perPlan[params.requestId]) {
        this.cost.perPlan[params.requestId] = {
          providerRequests: 0,
          estimatedTotalTokens: 0,
          estimatedCostUsd: 0,
        };
      }
      this.cost.perPlan[params.requestId].providerRequests++;
      this.cost.perPlan[params.requestId].estimatedTotalTokens += (params.inputTokens ?? 0) + (params.outputTokens ?? 0);
      if (params.model) {
        this.cost.perPlan[params.requestId].estimatedCostUsd += estimateCost(params.model, params.inputTokens ?? 0, params.outputTokens ?? 0);
      }
    }

    if (params.errorCode) {
      pm.errorCodeCounts[params.errorCode] = (pm.errorCodeCounts[params.errorCode] ?? 0) + 1;
      this.errorCountsByCode[params.errorCode] = (this.errorCountsByCode[params.errorCode] ?? 0) + 1;
    }

    this.providerLatencySamples[params.provider].push(params.durationMs);
    if (this.providerLatencySamples[params.provider].length > MAX_LATENCY_SAMPLES) {
      this.providerLatencySamples[params.provider].shift();
    }

    this.recordLatency(params.durationMs);
    if (params.durationMs > PERF_WARN_THRESHOLDS.providerLatencyMs) {
      this.pushWarning({
        type: "provider_latency",
        name: params.provider,
        value: params.durationMs,
        threshold: PERF_WARN_THRESHOLDS.providerLatencyMs,
        timestamp: Date.now(),
      });
    }

    if (params.trace) {
      this.pushTrace({
        ...params.trace,
        timestamp: new Date().toISOString(),
        status: params.success ? "success" : "failure",
        durationMs: params.durationMs,
        errorCode: params.errorCode,
        provider: params.provider,
        model: params.model,
      });
    }
  }

  recordBudgetViolation(violation: BudgetViolation): void {
    this.budgetViolations.push(violation);
  }

  recordQuotaCheck(check: QuotaCheck): void {
    this.quotaChecks.push(check);
    if (this.quotaChecks.length > 500) this.quotaChecks.shift();
  }

  recordTimelineSpan(span: Omit<TimelineSpan, "spanId">): void {
    if (!this.activeTimeline) return;

    const fullSpan: TimelineSpan = {
      ...span,
      spanId: `span-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      durationMs: span.endTime ? span.endTime - span.startTime : undefined,
    };

    this.activeTimeline.spans.push(fullSpan);
    if (fullSpan.type === "step" && typeof fullSpan.durationMs === "number") {
      if (!this.stepLatencySamples[fullSpan.name]) this.stepLatencySamples[fullSpan.name] = [];
      this.stepLatencySamples[fullSpan.name].push(fullSpan.durationMs);
      if (this.stepLatencySamples[fullSpan.name].length > MAX_LATENCY_SAMPLES) {
        this.stepLatencySamples[fullSpan.name].shift();
      }
    }
    if (this.activeTimeline.spans.length > MAX_TIMELINE_SPANS) {
      this.activeTimeline.spans.shift();
    }
  }

  recordCommandExecution(durationMs: number, success: boolean): void {
    this.commandCalls++;
    if (!success) this.commandFailures++;
    this.commandLatencySamples.push(durationMs);
    if (this.commandLatencySamples.length > MAX_LATENCY_SAMPLES) this.commandLatencySamples.shift();
  }

  recordFileOperationLatency(durationMs: number, success: boolean): void {
    this.fileOpCalls++;
    if (!success) this.fileOpFailures++;
    this.fileOpLatencySamples.push(durationMs);
    if (this.fileOpLatencySamples.length > MAX_LATENCY_SAMPLES) this.fileOpLatencySamples.shift();
  }

  recordPathSafetyCheck(durationMs: number, success: boolean): void {
    this.pathSafetyCalls++;
    if (!success) this.pathSafetyFailures++;
    this.pathSafetyLatencySamples.push(durationMs);
    if (this.pathSafetyLatencySamples.length > MAX_LATENCY_SAMPLES) this.pathSafetyLatencySamples.shift();
  }

  recordProtectedPathCheck(durationMs: number, success: boolean): void {
    this.protectedPathCalls++;
    if (!success) this.protectedPathFailures++;
    this.protectedPathLatencySamples.push(durationMs);
    if (this.protectedPathLatencySamples.length > MAX_LATENCY_SAMPLES) this.protectedPathLatencySamples.shift();
  }

  private pushWarning(w: PerformanceWarning): void {
    this.warnings.push(w);
    if (this.warnings.length > MAX_WARNINGS) this.warnings.shift();
  }

  startTimeline(planId: string, planName?: string): void {
    this.activeTimeline = {
      planId,
      planName,
      startTime: Date.now(),
      status: "running",
      spans: [],
    };
  }

  endTimeline(status: ExecutionTimeline["status"]): void {
    if (!this.activeTimeline) return;
    this.activeTimeline.endTime = Date.now();
    this.activeTimeline.status = status;
    const duration = this.activeTimeline.endTime - this.activeTimeline.startTime;
    if (duration > PERF_WARN_THRESHOLDS.planDurationMs) {
      this.pushWarning({
        type: "plan_duration",
        name: this.activeTimeline.planName ?? this.activeTimeline.planId,
        value: duration,
        threshold: PERF_WARN_THRESHOLDS.planDurationMs,
        timestamp: Date.now(),
      });
    }
    const toolSpans = this.activeTimeline.spans.filter(s => s.type === "tool").length;
    if (toolSpans > PERF_WARN_THRESHOLDS.excessiveToolCalls) {
      this.pushWarning({
        type: "excessive_tool_calls",
        name: this.activeTimeline.planName ?? this.activeTimeline.planId,
        value: toolSpans,
        threshold: PERF_WARN_THRESHOLDS.excessiveToolCalls,
        timestamp: Date.now(),
      });
    }
    this.planLatencySamples.push(duration);
    if (this.planLatencySamples.length > MAX_LATENCY_SAMPLES) {
      this.planLatencySamples.shift();
    }

    const inputTokens = Object.values(this.cost.modelBreakdown).reduce((s, m) => s + m.inputTokens, 0);
    const outputTokens = Object.values(this.cost.modelBreakdown).reduce((s, m) => s + m.outputTokens, 0);
    this.activeTimeline.totalTokens = inputTokens + outputTokens;
    this.activeTimeline.totalCostUsd = this.cost.estimatedCostUsd;

    this.timelines.push(this.activeTimeline);
    if (this.timelines.length > MAX_TIMELINES) {
      this.timelines.shift();
    }
    this.activeTimeline = null;
  }

  getActiveTracesCount(): number {
    return this.recentTraces.filter(t => {
      const age = Date.now() - new Date(t.timestamp).getTime();
      return age < 30_000;
    }).length;
  }

  private pushTrace(summary: TraceSummary): void {
    this.recentTraces.push(summary);
    if (this.recentTraces.length > this.maxRecentTraces) {
      this.recentTraces = this.recentTraces.slice(this.recentTraces.length - this.maxRecentTraces);
    }
  }

  private recordLatency(latencyMs: number): void {
    if (latencyMs < 100) this.latencyBuckets["0-100ms"]++;
    else if (latencyMs < 500) this.latencyBuckets["100-500ms"]++;
    else if (latencyMs < 2000) this.latencyBuckets["500-2000ms"]++;
    else this.latencyBuckets["2000ms+"]++;
  }

  private computePercentiles(samples: number[]): LatencyPercentiles {
    if (samples.length === 0) return { p50Ms: 0, p95Ms: 0, p99Ms: 0, count: 0 };
    const sorted = [...samples].sort((a, b) => a - b);
    return {
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
      count: sorted.length,
    };
  }

  private sanitizeForDisplay(data: unknown): unknown {
    if (data === null || data === undefined) return data;
    if (typeof data === "string") {
      const secretValuePatterns = [
        /sk-[A-Za-z0-9_-]{8,}/g,
        /api[_-]?key\s*[:=]\s*[^,\s]+/gi,
        /token\s*[:=]\s*[^,\s]+/gi,
        /password\s*[:=]\s*[^,\s]+/gi,
        /secret\s*[:=]\s*[^,\s]+/gi,
        /[A-Za-z]:\\Users\\[^\\\s]+(?:\\[^\\\s]+)*/g,
        /\/(?:Users|home|root|var|etc)\/[^\s"'`]+/g,
      ];
      let out = data;
      for (const p of secretValuePatterns) {
        out = out.replace(p, "[REDACTED]");
      }
      return out;
    }
    if (typeof data !== "object") return data;

    const SECRET_PATTERNS = [
      /api[-_]?key/i, /token/i, /password/i, /secret/i,
      /authorization/i, /credential/i, /private[-_]?key/i,
      /bearer\s+[a-z0-9\-._~+\/]+=*/i,
    ];

    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeForDisplay(item));
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (SECRET_PATTERNS.some(p => p.test(k))) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = this.sanitizeForDisplay(v);
      }
    }
    return out;
  }

  getSnapshot(): ObservabilitySnapshot {
    const hasFailures = Object.values(this.errorCountsByCode).reduce((a, b) => a + b, 0) > 0;
    const runtimeStatus = hasFailures ? "degraded" : "healthy";

    const toolLatencyPercentiles: ToolLatencyMetrics[] = Object.entries(this.toolLatencySamples).map(([name, samples]) => ({
      toolName: name,
      ...this.computePercentiles(samples),
      calls: this.toolMetrics[name]?.calls ?? 0,
      success: this.toolMetrics[name]?.success ?? 0,
      failure: this.toolMetrics[name]?.failure ?? 0,
      totalLatencyMs: this.toolMetrics[name]?.totalLatencyMs ?? 0,
      avgLatencyMs: this.toolMetrics[name]?.avgLatencyMs ?? 0,
    })).sort((a, b) => b.p99Ms - a.p99Ms);

    const providerLatencyPercentiles: ProviderLatencyMetrics[] = Object.entries(this.providerLatencySamples).map(([name, samples]) => ({
      provider: name,
      ...this.computePercentiles(samples),
      calls: this.providerMetrics[name]?.calls ?? 0,
      success: this.providerMetrics[name]?.success ?? 0,
      failure: this.providerMetrics[name]?.failure ?? 0,
      totalLatencyMs: this.providerMetrics[name]?.totalLatencyMs ?? 0,
      avgLatencyMs: this.providerMetrics[name]?.avgLatencyMs ?? 0,
    }));

    const topSlowTools: TopSlowTool[] = toolLatencyPercentiles
      .slice(0, MAX_SLOW_TOOLS)
      .map(t => ({ toolName: t.toolName, p99Ms: t.p99Ms, avgMs: t.avgLatencyMs, calls: t.calls }));
    const slowestProviderCalls = providerLatencyPercentiles
      .slice()
      .sort((a, b) => b.p99Ms - a.p99Ms)
      .slice(0, MAX_SLOW_TOOLS)
      .map(p => ({ provider: p.provider, p99Ms: p.p99Ms, avgMs: p.avgLatencyMs, calls: p.calls }));
    const slowestPlanSteps = Object.entries(this.stepLatencySamples)
      .map(([stepName, samples]) => {
        const p = this.computePercentiles(samples);
        const avgMs = samples.reduce((s, n) => s + n, 0) / Math.max(1, samples.length);
        return { stepName, p99Ms: p.p99Ms, avgMs, calls: samples.length };
      })
      .sort((a, b) => b.p99Ms - a.p99Ms)
      .slice(0, MAX_SLOW_TOOLS);
    const highErrorTools = Object.entries(this.toolMetrics)
      .map(([toolName, m]) => ({
        toolName,
        failures: m.failure,
        calls: m.calls,
        failureRate: m.calls === 0 ? 0 : m.failure / m.calls,
      }))
      .filter(x => x.failures > 0)
      .sort((a, b) => b.failures - a.failures)
      .slice(0, MAX_SLOW_TOOLS);
    const highDenialTools = Object.entries(this.toolDenialCounts)
      .map(([toolName, denials]) => ({ toolName, denials }))
      .sort((a, b) => b.denials - a.denials)
      .slice(0, MAX_SLOW_TOOLS);

    const profiling: ProfilingSnapshot = {
      slowestTools: topSlowTools,
      slowestProviderCalls,
      slowestPlanSteps,
      commandLatency: { ...this.computePercentiles(this.commandLatencySamples), calls: this.commandCalls, failures: this.commandFailures },
      fileOperationLatency: { ...this.computePercentiles(this.fileOpLatencySamples), calls: this.fileOpCalls, failures: this.fileOpFailures },
      pathSafetyLatency: { ...this.computePercentiles(this.pathSafetyLatencySamples), calls: this.pathSafetyCalls, failures: this.pathSafetyFailures },
      protectedPathLatency: { ...this.computePercentiles(this.protectedPathLatencySamples), calls: this.protectedPathCalls, failures: this.protectedPathFailures },
      highErrorTools,
      highDenialTools,
      warnings: this.warnings.slice(-100),
    };

    const planLatencyPercentiles = this.computePercentiles(this.planLatencySamples);
    const totalOutcomes = this.executionSuccessCount + this.executionFailureCount;
    const successRate = totalOutcomes === 0 ? 1 : this.executionSuccessCount / totalOutcomes;
    const failureRate = totalOutcomes === 0 ? 0 : this.executionFailureCount / totalOutcomes;

    const sanitized = this.sanitizeForDisplay({
      runtimeStatus,
      totalExecutions: this.totalExecutions,
      errorCountsByCode: { ...this.errorCountsByCode },
      policyDenials: this.policyDenials,
      providerFailures: this.providerFailures,
      latencyBuckets: { ...this.latencyBuckets },
      budgetViolations: this.budgetViolations.slice(-100),
      cost: { ...this.cost },
      toolLatencyPercentiles: toolLatencyPercentiles.slice(0, MAX_SLOW_TOOLS * 2),
      providerLatencyPercentiles: providerLatencyPercentiles.slice(0, 10),
      planLatencyPercentiles,
      topSlowTools,
      profiling,
      cache: (() => {
        const c = globalCacheEngine.snapshot();
        return {
          entries: c.entries,
          maxEntries: c.maxEntries,
          ttlMs: c.ttlMs,
          hitRatio: c.hitRatio,
          hits: c.metrics.hits,
          misses: c.metrics.misses,
          evictions: c.metrics.evictions,
          invalidations: c.metrics.invalidations,
        };
      })(),
      quota: {
        checks: this.quotaChecks.length,
        violations: this.quotaChecks.filter(c => !c.passed).length,
        recentChecks: this.quotaChecks.slice(-100),
      },
      activeTraces: this.getActiveTracesCount(),
      successCount: this.executionSuccessCount,
      failureCount: this.executionFailureCount,
      successRate,
      failureRate,
      toolMetrics: this.sanitizeForDisplay(this.toolMetrics),
      providerMetrics: this.sanitizeForDisplay(this.providerMetrics),
      recentTraces: this.recentTraces.slice(-MAX_RECENT_TRACES),
      timelines: this.timelines.slice(-MAX_TIMELINES),
    });

    return {
      ...sanitized as ObservabilitySnapshot,
      safeForDisplay: true,
    };
  }

  reset(): void {
    this.errorCountsByCode = {};
    this.toolMetrics = {};
    this.providerMetrics = {};
    this.recentTraces = [];
    this.latencyBuckets = { "0-100ms": 0, "100-500ms": 0, "500-2000ms": 0, "2000ms+": 0 };
    this.totalExecutions = 0;
    this.policyDenials = 0;
    this.providerFailures = 0;
    this.budgetViolations = [];
    this.timelines = [];
    this.toolLatencySamples = {};
    this.providerLatencySamples = {};
    this.planLatencySamples = [];
    this.stepLatencySamples = {};
    this.commandLatencySamples = [];
    this.fileOpLatencySamples = [];
    this.pathSafetyLatencySamples = [];
    this.commandCalls = 0;
    this.commandFailures = 0;
    this.fileOpCalls = 0;
    this.fileOpFailures = 0;
    this.pathSafetyCalls = 0;
    this.pathSafetyFailures = 0;
    this.protectedPathLatencySamples = [];
    this.protectedPathCalls = 0;
    this.protectedPathFailures = 0;
    this.toolDenialCounts = {};
    this.warnings = [];
    this.quotaChecks = [];
    this.executionSuccessCount = 0;
    this.executionFailureCount = 0;
    this.cost = {
      providerRequests: 0, estimatedInputTokens: 0,
      estimatedOutputTokens: 0, estimatedTotalTokens: 0, estimatedCostUsd: 0, perPlan: {}, modelBreakdown: {},
    };
  }

  getCost(): ExecutionCost {
    return {
      providerRequests: this.cost.providerRequests,
      estimatedInputTokens: this.cost.estimatedInputTokens,
      estimatedOutputTokens: this.cost.estimatedOutputTokens,
      estimatedTotalTokens: this.cost.estimatedInputTokens + this.cost.estimatedOutputTokens,
      estimatedCostUsd: this.cost.estimatedCostUsd,
      perPlan: { ...this.cost.perPlan },
      modelBreakdown: { ...this.cost.modelBreakdown },
    };
  }

  getTimelines(): ExecutionTimeline[] {
    return [...this.timelines];
  }

  getToolLatencyPercentiles(toolName: string): ToolLatencyMetrics | null {
    const samples = this.toolLatencySamples[toolName];
    if (!samples || samples.length === 0) return null;
    const p = this.computePercentiles(samples);
    const tm = this.toolMetrics[toolName];
    return {
      toolName,
      ...p,
      calls: tm?.calls ?? 0,
      success: tm?.success ?? 0,
      failure: tm?.failure ?? 0,
      totalLatencyMs: tm?.totalLatencyMs ?? 0,
      avgLatencyMs: tm?.avgLatencyMs ?? 0,
    };
  }
}

export const globalObservability = new ObservabilityStore();
export { estimateCost, MODEL_TOKEN_RATES };
