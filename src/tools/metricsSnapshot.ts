import { z } from "zod";
import { globalObservability } from "../core/observability.js";
import { globalBudgetEngine } from "../core/budgetEngine.js";

export const metricsSnapshotSchema = z.object({
  requestId: z.string().optional().describe("Scope metrics to a specific requestId chain"),
  includeTimelines: z.boolean().optional().default(false).describe("Include execution timelines"),
  includeProfiling: z.boolean().optional().default(true).describe("Include profiling snapshot"),
  includeTopSlow: z.boolean().optional().default(true).describe("Include top slow tools"),
  topN: z.number().int().min(1).max(50).optional().default(10),
}).strict();

export async function metricsSnapshotToolHandler(input: {
  requestId?: string;
  includeTimelines?: boolean;
  includeProfiling?: boolean;
  includeTopSlow?: boolean;
  topN?: number;
}) {
  const snap = globalObservability.getSnapshot();
  const cost = globalObservability.getCost();
  const timelines = input.includeTimelines ? (snap.timelines ?? []) : [];

  let topSlowTools = snap.topSlowTools ?? [];
  if (input.topN !== undefined) {
    topSlowTools = topSlowTools.slice(0, input.topN);
  }

  const output = {
    runtimeStatus: snap.runtimeStatus,
    totalExecutions: snap.totalExecutions,
    executionCounts: {
      toolExecutions: snap.totalExecutions,
      providerRequests: cost.providerRequests,
      successCount: snap.successCount,
      failureCount: snap.failureCount,
    },
    successRate: snap.successRate,
    failureRate: snap.failureRate,
    cost: {
      estimatedInputTokens: cost.estimatedInputTokens,
      estimatedOutputTokens: cost.estimatedOutputTokens,
      estimatedTotalTokens: cost.estimatedTotalTokens,
      estimatedCostUsd: cost.estimatedCostUsd,
      perPlan: cost.perPlan,
      modelBreakdown: cost.modelBreakdown,
    },
    budgetViolations: snap.budgetViolations?.slice(-50) ?? [],
    latency: {
      buckets: snap.latencyBuckets,
      toolPercentiles: (snap.toolLatencyPercentiles ?? []).slice(0, input.topN ?? 10),
      providerPercentiles: (snap.providerLatencyPercentiles ?? []).slice(0, 10),
      planPercentiles: snap.planLatencyPercentiles,
    },
    topSlowTools,
    errors: {
      byCode: snap.errorCountsByCode,
      policyDenials: snap.policyDenials,
      providerFailures: snap.providerFailures,
      providerErrorCounts: Object.fromEntries(
        Object.entries(snap.providerMetrics ?? {}).map(([provider, m]) => [provider, m.errorCodeCounts ?? {}])
      ),
    },
    activeTraces: snap.activeTraces ?? 0,
    safeForDisplay: snap.safeForDisplay ?? true,
    cache: snap.cache,
    quota: snap.quota,
  };

  if (input.includeProfiling !== false) {
    (output as Record<string, unknown>).profiling = snap.profiling;
  }

  if (input.requestId) {
    const budgetState = globalBudgetEngine.getState(input.requestId);
    (output as Record<string, unknown>).budgetState = budgetState;
  }

  if (timelines.length > 0) {
    (output as Record<string, unknown>).timelines = timelines.slice(-10);
  }

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(output, null, 2),
    }],
  };
}
