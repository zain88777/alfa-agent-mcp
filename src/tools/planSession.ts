import { z } from "zod";
import { normalizeInput } from "../core/inputNormalizer.js";
import { globalTransactionEngine, TransactionSession } from "../core/transactionEngine.js";
import { ToolExecutionErrorClass, ErrorCode } from "../core/errorResponse.js";
import { globalObservability } from "../core/observability.js";
import { globalCacheEngine } from "../core/cacheEngine.js";
import { globalSessionCoordinator } from "../core/sessionCoordinator.js";

export const planSessionSchema = z.object({
  action: z.enum(["start", "preview", "commit", "rollback", "status", "list", "close"]).describe("Session action"),
  sessionId: z.string().optional().describe("Session ID (required for preview/commit/rollback/close/status)"),
  name: z.string().optional().describe("Session name for tracking"),
}).strict();

export async function planSessionToolHandler(input: {
  action: string;
  sessionId?: string;
  name?: string;
}) {
  const normalizedInput = normalizeInput(input);
  const action = normalizedInput.action as TransactionSession["status"] | string;

  switch (action) {
    case "start": {
      const session = globalTransactionEngine.createSession(
        normalizedInput.name,
        globalSessionCoordinator.getIdentity().sessionId
      );
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            sessionId: session.id,
            name: session.name,
            status: session.status,
            stepCount: 0,
            message: `Transaction session started. Use sessionId '${session.id}' to stage mutations.`,
            availableActions: ["preview", "commit", "rollback", "close"],
          }, null, 2),
        }],
      };
    }

    case "preview": {
      if (!normalizedInput.sessionId) {
        throw new ToolExecutionErrorClass(ErrorCode.VALIDATION_FAILED, "sessionId is required for preview", { tool: "plan_session", retryable: false });
      }
      const result = globalTransactionEngine.preview(normalizedInput.sessionId);
      if (!result) {
        throw new ToolExecutionErrorClass(ErrorCode.VALIDATION_FAILED, `Session not found or not in active state: ${normalizedInput.sessionId}`, { tool: "plan_session", retryable: false });
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            sessionId: result.session.id,
            status: result.session.status,
            summary: result.summary,
            steps: result.session.steps.map(s => ({
              id: s.id,
              tool: s.toolName,
              kind: s.kind,
              paths: s.paths,
              preview: s.preview,
              hasBackup: !!s.backupPath,
            })),
            message: `Review the staged changes above. Use action='commit' to apply or action='rollback' to discard.`,
          }, null, 2),
        }],
      };
    }

    case "commit": {
      if (!normalizedInput.sessionId) {
        throw new ToolExecutionErrorClass(ErrorCode.VALIDATION_FAILED, "sessionId is required for commit", { tool: "plan_session", retryable: false });
      }
      const result = await globalTransactionEngine.commit(normalizedInput.sessionId);
      if (!result) {
        throw new ToolExecutionErrorClass(ErrorCode.VALIDATION_FAILED, `Session not found or not in committable state: ${normalizedInput.sessionId}`, { tool: "plan_session", retryable: false });
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            sessionId: result.session.id,
            status: result.session.status,
            stepCount: result.session.steps.length,
            results: result.results,
            message: `Session committed: ${result.session.steps.length} mutation(s) applied.`,
          }, null, 2),
        }],
      };
    }

    case "rollback": {
      if (!normalizedInput.sessionId) {
        throw new ToolExecutionErrorClass(ErrorCode.VALIDATION_FAILED, "sessionId is required for rollback", { tool: "plan_session", retryable: false });
      }
      const rollbackStart = Date.now();
      const result = await globalTransactionEngine.rollback(normalizedInput.sessionId);
      if (!result) {
        throw new ToolExecutionErrorClass(ErrorCode.VALIDATION_FAILED, `Session not found: ${normalizedInput.sessionId}`, { tool: "plan_session", retryable: false });
      }
      globalObservability.recordTimelineSpan({
        type: "rollback",
        name: `rollback_${normalizedInput.sessionId}`,
        startTime: rollbackStart,
        endTime: Date.now(),
        success: result.errors.length === 0,
        errorCode: result.errors.length > 0 ? "ROLLBACK_PARTIAL" : undefined,
      });
      if (result.restored.length > 0) {
        globalCacheEngine.invalidateTools([
          "code_map",
          "symbol_graph",
          "references",
          "project_tree",
          "import_graph",
          "workspace_config",
          "metrics_snapshot",
        ]);
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            sessionId: result.session.id,
            status: result.session.status,
            restored: result.restored,
            rollbackErrors: result.errors,
            message: result.errors.length > 0
              ? `Rollback completed with ${result.errors.length} error(s). ${result.restored.length} file(s) restored.`
              : `Rollback complete: ${result.restored.length} file(s) restored.`,
          }, null, 2),
        }],
      };
    }

    case "status": {
      if (!normalizedInput.sessionId) {
        throw new ToolExecutionErrorClass(ErrorCode.VALIDATION_FAILED, "sessionId is required for status", { tool: "plan_session", retryable: false });
      }
      const session = globalTransactionEngine.getSession(normalizedInput.sessionId);
      if (!session) {
        throw new ToolExecutionErrorClass(ErrorCode.VALIDATION_FAILED, `Session not found: ${normalizedInput.sessionId}`, { tool: "plan_session", retryable: false });
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            sessionId: session.id,
            name: session.name,
            status: session.status,
            stepCount: session.steps.length,
            createdAt: new Date(session.createdAt).toISOString(),
            committedAt: session.committedAt ? new Date(session.committedAt).toISOString() : null,
            rolledBackAt: session.rolledBackAt ? new Date(session.rolledBackAt).toISOString() : null,
            failureReason: session.failureReason ?? null,
            steps: session.steps.map(s => ({ id: s.id, tool: s.toolName, kind: s.kind, paths: s.paths, committed: s.committed })),
          }, null, 2),
        }],
      };
    }

    case "list": {
      const sessions = globalTransactionEngine.listSessions();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            activeSessions: sessions.length,
            sessions: sessions.map(s => ({
              sessionId: s.id,
              name: s.name,
              status: s.status,
              stepCount: s.steps.length,
              createdAt: new Date(s.createdAt).toISOString(),
            })),
          }, null, 2),
        }],
      };
    }

    case "close": {
      if (!normalizedInput.sessionId) {
        throw new ToolExecutionErrorClass(ErrorCode.VALIDATION_FAILED, "sessionId is required for close", { tool: "plan_session", retryable: false });
      }
      const closed = globalTransactionEngine.closeSession(normalizedInput.sessionId);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            sessionId: normalizedInput.sessionId,
            closed,
            message: closed ? "Session closed." : "Session not found.",
          }, null, 2),
        }],
      };
    }

    default: {
      throw new ToolExecutionErrorClass(
        ErrorCode.VALIDATION_FAILED,
        `Unknown action: ${action}. Valid actions: start, preview, commit, rollback, status, list, close`,
        { tool: "plan_session", retryable: false }
      );
    }
  }
}
