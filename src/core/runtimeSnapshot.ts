import path from "node:path";
import { buildProviderConfig, loadRuntimeConfig } from "./runtimeConfig.js";
import { redactProviderConfig } from "../llm/providerUtils.js";
import { ToolRegistry } from "./toolRegistry.js";
import { globalObservability } from "./observability.js";
import { globalTransactionEngine } from "./transactionEngine.js";
import { ApprovalStatus } from "./approvalEngine.js";
import { PolicyTier } from "./policyEngine.js";

export interface RuntimeSnapshot {
  generatedAt: string;
  health: ReturnType<ToolRegistry["getHealthSnapshot"]>;
  policyCoverage: {
    totalTools: number;
    classifiedTools: number;
    unclassifiedTools: number;
    byTier: Record<PolicyTier, number>;
  };
  approvals: {
    pending: number;
    approved: number;
    denied: number;
    expired: number;
    revoked: number;
  };
  activeTraces: {
    activeCount: number;
    recentTraceCount: number;
  };
  metrics: ReturnType<typeof globalObservability.getSnapshot>;
  quota: ReturnType<typeof globalObservability.getSnapshot>["quota"];
  cache: ReturnType<typeof globalObservability.getSnapshot>["cache"];
  transactions: ReturnType<typeof globalTransactionEngine.getRecoverySummary>;
  configSummary: {
    provider: ReturnType<typeof redactProviderConfig>;
    workspace: {
      label: string;
    };
    debugMode: boolean;
    timeouts: ReturnType<typeof loadRuntimeConfig>["timeouts"];
    policy: ReturnType<typeof loadRuntimeConfig>["policy"];
    observability: ReturnType<typeof loadRuntimeConfig>["observability"];
  };
  recoveryReadiness: {
    activeTransactions: number;
    failedSessions: number;
    rollbackEligibleSessions: number;
    pendingApprovals: number;
    quotaViolations: number;
    recentErrors: Array<{ timestamp: string; errorCode?: string; toolName?: string; provider?: string }>;
  };
}

export function buildRuntimeSnapshot(registry: ToolRegistry): RuntimeSnapshot {
  const health = registry.getHealthSnapshot();
  const policies = registry.getPolicyEngine().listPolicies();
  const tools = registry.list();
  const approvals = registry.getApprovalEngine().list();
  const metrics = globalObservability.getSnapshot();
  const transactions = globalTransactionEngine.getRecoverySummary();
  const cfg = loadRuntimeConfig();
  const provider = redactProviderConfig(buildProviderConfig());

  const byTier: Record<PolicyTier, number> = {
    [PolicyTier.READ_ONLY]: 0,
    [PolicyTier.SAFE_WRITE]: 0,
    [PolicyTier.DANGEROUS]: 0,
    [PolicyTier.SYSTEM_SENSITIVE]: 0,
  };
  for (const p of policies) {
    byTier[p.policy.tier] = (byTier[p.policy.tier] ?? 0) + 1;
  }

  const recentErrors = metrics.recentTraces
    .filter((t) => t.status === "failure")
    .slice(-20)
    .map((t) => ({
      timestamp: t.timestamp,
      errorCode: t.errorCode,
      toolName: t.toolName,
      provider: t.provider,
    }));

  return {
    generatedAt: new Date().toISOString(),
    health,
    policyCoverage: {
      totalTools: tools.length,
      classifiedTools: policies.length,
      unclassifiedTools: Math.max(0, tools.length - policies.length),
      byTier,
    },
    approvals: {
      pending: approvals.filter((a) => a.status === ApprovalStatus.PENDING).length,
      approved: approvals.filter((a) => a.status === ApprovalStatus.APPROVED).length,
      denied: approvals.filter((a) => a.status === ApprovalStatus.DENIED).length,
      expired: approvals.filter((a) => a.status === ApprovalStatus.EXPIRED).length,
      revoked: approvals.filter((a) => a.status === ApprovalStatus.REVOKED).length,
    },
    activeTraces: {
      activeCount: metrics.activeTraces,
      recentTraceCount: metrics.recentTraces.length,
    },
    metrics,
    quota: metrics.quota,
    cache: metrics.cache,
    transactions,
    configSummary: {
      provider,
      workspace: {
        // Keep human-usable context without leaking absolute paths.
        label: path.basename(cfg.workspaceRoot) || "workspace",
      },
      debugMode: cfg.debugMode,
      timeouts: cfg.timeouts,
      policy: cfg.policy,
      observability: cfg.observability,
    },
    recoveryReadiness: {
      activeTransactions: transactions.activeTransactions,
      failedSessions: transactions.failedSessions,
      rollbackEligibleSessions: transactions.rollbackEligibleSessions,
      pendingApprovals: approvals.filter((a) => a.status === ApprovalStatus.PENDING).length,
      quotaViolations: metrics.quota.violations,
      recentErrors,
    },
  };
}
