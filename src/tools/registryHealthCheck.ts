/**
 * Registry health check tool — uses getHealthSnapshot() for decoupled observability.
 * Health checks read from the HealthSnapshot interface, not internal RegistryStats directly.
 * This prevents metric refactors from breaking tooling.
 */

import { ToolRegistry } from "../core/toolRegistry.js";

export async function registryHealthCheckToolHandler(
  input: { registry?: ToolRegistry } = {}
) {
  if (!input.registry) {
    throw new Error("Registry instance is required");
  }

  const registry = input.registry;

  // Use getHealthSnapshot() — decoupled from internal metric shapes
  const snapshot = registry.getHealthSnapshot();

  // Get per-tool details via the stable stats API
  const stats = registry.getStats();
  const toolCount = Object.keys(stats.perTool).length;

  // Build tool breakdown from snapshot data + stable API
  const toolBreakdown: Record<string, unknown> = {};
  for (const name of registry.list()) {
    const toolStats = registry.getToolStats(name);
    const latency = registry.getToolLatencyPercentiles(name);
    toolBreakdown[name] = {
      executions: toolStats?.executions ?? 0,
      errors: toolStats?.errors ?? 0,
      minMs: toolStats?.minMs === Infinity ? "N/A" : (toolStats?.minMs.toFixed(1) ?? "N/A"),
      maxMs: toolStats?.maxMs === -Infinity ? "N/A" : (toolStats?.maxMs.toFixed(1) ?? "N/A"),
      avgLatencyMs: toolStats?.avgLatencyMs.toFixed(1) ?? "N/A",
      p50Ms: latency?.p50Ms.toFixed(1) ?? "N/A",
      p95Ms: latency?.p95Ms.toFixed(1) ?? "N/A",
      errorRate: (toolStats && toolStats.executions > 0)
        ? ((toolStats.errors / toolStats.executions) * 100).toFixed(1) + "%"
        : "0%",
      hasSchema: !!registry.getSchema(name),
    };
  }

  const report = {
    // Health from decoupled snapshot
    status: snapshot.status,
    totalTools: snapshot.totalTools,
    healthyTools: snapshot.healthyTools,
    schematizedTools: snapshot.schematizedTools,
    schematizedRate: toolCount > 0
      ? ((snapshot.schematizedTools / toolCount) * 100).toFixed(1) + "%"
      : "N/A",

    // Execution statistics from snapshot
    totalExecutions: snapshot.totalExecutions,
    totalErrors: snapshot.totalErrors,
    timeoutCounts: snapshot.timeoutCounts,
    cancellationCounts: snapshot.cancellationCounts,
    successRate: snapshot.successRate,
    latencyBuckets: snapshot.latencyBuckets,

    // Issues from snapshot
    issues: snapshot.issues,

    // Per-tool breakdown via stable APIs
    toolBreakdown,

    // Top-level health message
    message: snapshot.status === "healthy"
      ? `All ${snapshot.totalTools} tools registered and callable`
      : `${snapshot.issues.length} issue(s) found — check 'issues' field`,
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(report, null, 2),
      },
    ],
  };
}
