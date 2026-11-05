/**
 * Transaction engine — in-memory staged mutation tracking for session safety.
 *
 * A transaction session collects mutations from mutation tools (write_file,
 * delete_file, move_file, copy_file, apply_patch, unified_patch) and
 * maintains a preview of planned changes alongside rollback metadata.
 *
 * SAFETY GUARANTEES:
 * - All state is session-scoped — no global transaction state
 * - No persistence — state is transient per session
 * - Rollback restores files by copying from pre-mutation backups
 * - Pre-commit preview aggregates all dry-run outputs for review
 *
 * ARCHITECTURE:
 * Each mutation tool calls transactionEngine.recordStep() BEFORE executing
 * (or after previewing with dryRun:true). The session tracks:
 *   - path: affected file path
 *   - kind: write | delete | move | copy | patch
 *   - preview: dry-run output (what would happen)
 *   - backup: path to pre-mutation backup (for rollback)
 *   - committed: whether step has been applied
 *
 * SESSION LIFECYCLE:
 *   start → step × N → preview | commit | rollback → close
 */

import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { getWorkspaceRoot } from "./workspaceContext.js";
import { globalAuditTrail } from "./auditTrail.js";

export type MutationKind = "write" | "delete" | "move" | "copy" | "patch";

export interface TransactionStep {
  id: string;
  toolName: string;
  kind: MutationKind;
  paths: string[];
  preview: string;
  backupPath?: string;
  committed: boolean;
  timestamp: number;
}

export interface TransactionSession {
  id: string;
  sessionId?: string;
  name?: string;
  status: "active" | "preview" | "committed" | "rolled_back" | "failed";
  steps: TransactionStep[];
  createdAt: number;
  committedAt?: number;
  rolledBackAt?: number;
  failureReason?: string;
}

export interface TransactionSessionSummary {
  id: string;
  sessionId?: string;
  status: TransactionSession["status"];
  createdAt: number;
  stepCount: number;
  rollbackEligible: boolean;
}

export interface TransactionRecoverySummary {
  totalSessions: number;
  activeTransactions: number;
  failedSessions: number;
  rollbackEligibleSessions: number;
  sessions: TransactionSessionSummary[];
}

export class TransactionEngine {
  private sessions: Map<string, TransactionSession> = new Map();
  private persistedSummaries: TransactionSessionSummary[] = [];

  createSession(name?: string, sessionId?: string): TransactionSession {
    const session: TransactionSession = {
      id: randomUUID(),
      sessionId,
      name,
      status: "active",
      steps: [],
      createdAt: Date.now(),
    };
    this.sessions.set(session.id, session);
    globalAuditTrail.record("transaction", "start", { sessionId: session.id, ownerSessionId: session.sessionId });
    return session;
  }

  getSession(id: string): TransactionSession | undefined {
    return this.sessions.get(id);
  }

  recordStep(
    sessionId: string,
    toolName: string,
    kind: MutationKind,
    paths: string[],
    preview: string,
    backupPath?: string
  ): TransactionStep | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "active") return null;

    const step: TransactionStep = {
      id: randomUUID(),
      toolName,
      kind,
      paths,
      preview,
      backupPath,
      committed: false,
      timestamp: Date.now(),
    };
    session.steps.push(step);
    return step;
  }

  preview(sessionId: string): { session: TransactionSession; previews: string[]; summary: string } | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "active") return null;

    session.status = "preview";
    const previews = session.steps.map(
      (s, i) => `[${i + 1}] ${s.toolName} (${s.kind}): ${s.preview}`
    );
    const summary = `Session '${session.name ?? session.id}' — ${session.steps.length} step(s) staged`;
    return { session, previews, summary };
  }

  async commit(sessionId: string): Promise<{ session: TransactionSession; results: string[] } | null> {
    const session = this.sessions.get(sessionId);
    if (!session || (session.status !== "active" && session.status !== "preview")) return null;

    for (const step of session.steps) {
      step.committed = true;
    }
    session.status = "committed";
    session.committedAt = Date.now();
    globalAuditTrail.record("transaction", "commit", { sessionId: session.id, stepCount: session.steps.length });

    const results = session.steps.map(
      (s, i) => `[${i + 1}] ${s.toolName} (${s.kind}): committed`
    );
    return { session, results };
  }

  async rollback(sessionId: string): Promise<{ session: TransactionSession; restored: string[]; errors: string[] } | null> {
    const session = this.sessions.get(sessionId);
    if (!session || (session.status !== "active" && session.status !== "preview" && session.status !== "failed")) {
      return null;
    }

    const workspaceRoot = getWorkspaceRoot();
    const restored: string[] = [];
    const errors: string[] = [];

    const stepsToRollback = [...session.steps].reverse();
    for (const step of stepsToRollback) {
      if (!step.committed && step.backupPath) {
        try {
          const exists = await fs.access(step.backupPath).then(() => true).catch(() => false);
          if (exists) {
            for (const targetPath of step.paths) {
              const normalizedTarget = path.join(workspaceRoot, targetPath);
              const targetDir = path.dirname(normalizedTarget);
              await fs.mkdir(targetDir, { recursive: true });
              await fs.copyFile(step.backupPath, normalizedTarget);
              restored.push(targetPath);
            }
          }
        } catch (e) {
          errors.push(`Rollback error for ${step.paths.join(", ")}: ${(e as Error).message}`);
        }
      }
    }

    session.status = "rolled_back";
    session.rolledBackAt = Date.now();
    globalAuditTrail.record("transaction", "rollback", { sessionId: session.id, restoredCount: restored.length, errorCount: errors.length });
    return { session, restored, errors };
  }

  markFailed(sessionId: string, reason: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.status = "failed";
    session.failureReason = reason;
    globalAuditTrail.record("transaction", "fail", { sessionId, reason });
    return true;
  }

  listSessions(): TransactionSession[] {
    return Array.from(this.sessions.values())
      .filter(s => s.status === "active" || s.status === "preview")
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  closeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (session.status === "active") {
      session.status = "failed";
      session.failureReason = "Session closed without commit or rollback";
    }
    return true;
  }

  getRecoverySummary(): TransactionRecoverySummary {
    const runtimeSessions = Array.from(this.sessions.values()).map((s) => {
      const rollbackEligible =
        (s.status === "active" || s.status === "preview" || s.status === "failed") &&
        s.steps.some((step) => Boolean(step.backupPath));
      return {
        id: s.id,
        sessionId: s.sessionId,
        status: s.status,
        createdAt: s.createdAt,
        stepCount: s.steps.length,
        rollbackEligible,
      };
    });
    const sessions = [...runtimeSessions, ...this.persistedSummaries];

    return {
      totalSessions: sessions.length,
      activeTransactions: sessions.filter((s) => s.status === "active" || s.status === "preview").length,
      failedSessions: sessions.filter((s) => s.status === "failed").length,
      rollbackEligibleSessions: sessions.filter((s) => s.rollbackEligible).length,
      sessions: sessions.sort((a, b) => b.createdAt - a.createdAt),
    };
  }

  reset(): void {
    this.sessions.clear();
    this.persistedSummaries = [];
  }

  exportSafeSessionSummaries(): TransactionSessionSummary[] {
    return this.getRecoverySummary().sessions;
  }

  importSafeSessionSummaries(summaries: TransactionSessionSummary[]): void {
    this.persistedSummaries = summaries;
  }

  markStaleSessionsFailed(staleBeforeMs: number): number {
    let changed = 0;
    for (const s of this.sessions.values()) {
      if ((s.status === "active" || s.status === "preview") && s.createdAt < staleBeforeMs) {
        s.status = "failed";
        s.failureReason = "Session marked stale during recovery";
        changed++;
      }
    }
    return changed;
  }

  listRollbackEligibleSessionIds(): string[] {
    return Array.from(this.sessions.values())
      .filter((s) =>
        (s.status === "active" || s.status === "preview" || s.status === "failed") &&
        s.steps.some((step) => Boolean(step.backupPath))
      )
      .map((s) => s.id);
  }
}

export const globalTransactionEngine = new TransactionEngine();
