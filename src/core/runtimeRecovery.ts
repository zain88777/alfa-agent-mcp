import { ToolExecutionErrorClass, ErrorCode } from "./errorResponse.js";
import { globalTransactionEngine } from "./transactionEngine.js";
import { globalObservability } from "./observability.js";
import { ToolRegistry } from "./toolRegistry.js";
import { globalSessionCoordinator } from "./sessionCoordinator.js";
import { globalAuditTrail } from "./auditTrail.js";

export interface RecoveryReport {
  activeTransactions: number;
  failedSessions: number;
  rollbackEligibleSessions: number;
  pendingApprovals: number;
  recentQuotaViolations: number;
  recentErrors: Array<{ timestamp: string; errorCode?: string }>;
  staleSessions: string[];
  staleLock: boolean;
}

export function buildRecoveryReport(registry: ToolRegistry): RecoveryReport {
  const tx = globalTransactionEngine.getRecoverySummary();
  const pendingApprovals = registry.getApprovalEngine().listPending().length;
  const obs = globalObservability.getSnapshot();
  const staleThreshold = Date.now() - 30 * 60 * 1000;
  const staleSessions = tx.sessions
    .filter((s) => (s.status === "active" || s.status === "preview") && s.createdAt < staleThreshold)
    .map((s) => s.id);

  return {
    activeTransactions: tx.activeTransactions,
    failedSessions: tx.failedSessions,
    rollbackEligibleSessions: tx.rollbackEligibleSessions,
    pendingApprovals,
    recentQuotaViolations: obs.quota.violations,
    recentErrors: obs.recentTraces.filter((t) => t.status === "failure").slice(-20).map((t) => ({ timestamp: t.timestamp, errorCode: t.errorCode })),
    staleSessions,
    staleLock: globalSessionCoordinator.getCoordinationReport().staleLock,
  };
}

export async function applyRecoveryAction(action: "inspect" | "mark_stale_failed" | "rollback_if_eligible", sessionId?: string): Promise<{ ok: boolean; message: string }> {
  if (action === "inspect") {
    globalAuditTrail.record("recovery", "inspect", {});
    return { ok: true, message: "Inspection only. No mutations executed." };
  }
  if (!sessionId) {
    throw new ToolExecutionErrorClass(ErrorCode.VALIDATION_FAILED, "sessionId is required for recovery action", { tool: "runtime_recovery", retryable: false });
  }

  if (action === "mark_stale_failed") {
    const session = globalTransactionEngine.getSession(sessionId);
    if (!session) return { ok: false, message: "Session not found" };
    if (session.status !== "active" && session.status !== "preview") {
      return { ok: false, message: "Session is not active/preview" };
    }
    globalTransactionEngine.markFailed(sessionId, "Marked failed by recovery action");
    globalAuditTrail.record("recovery", "mark_stale_failed", { sessionId });
    return { ok: true, message: "Session marked as failed" };
  }

  if (action === "rollback_if_eligible") {
    const eligible = globalTransactionEngine.listRollbackEligibleSessionIds().includes(sessionId);
    if (!eligible) return { ok: false, message: "Session is not rollback-eligible" };
    const result = await globalTransactionEngine.rollback(sessionId);
    globalAuditTrail.record("recovery", "rollback_if_eligible", { sessionId, ok: Boolean(result) });
    return { ok: Boolean(result), message: result ? "Rollback attempted for eligible session" : "Rollback failed" };
  }

  return { ok: false, message: "Unknown action" };
}
