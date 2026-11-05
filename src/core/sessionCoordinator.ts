import crypto from "node:crypto";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ToolExecutionErrorClass, ErrorCode } from "./errorResponse.js";
import { getWorkspaceRoot } from "./workspaceContext.js";

export interface RuntimeSessionIdentity {
  sessionId: string;
  createdAt: number;
  workspaceLabel: string;
  workspaceFingerprint: string;
  status: "active" | "closed" | "stale";
}

export interface MutationLock {
  ownerSessionId: string;
  acquiredAt: number;
  toolName: string;
}

const STALE_LOCK_MS = 120_000;

export class SessionCoordinator {
  private static workspaceLocks: Map<string, MutationLock> = new Map();
  private readonly identity: RuntimeSessionIdentity;

  constructor(sessionId?: string, workspaceRoot: string = getWorkspaceRoot()) {
    const ws = path.resolve(workspaceRoot);
    this.identity = {
      sessionId: sessionId ?? randomUUID(),
      createdAt: Date.now(),
      workspaceLabel: path.basename(ws) || "workspace",
      workspaceFingerprint: crypto.createHash("sha256").update(ws).digest("hex").slice(0, 16),
      status: "active",
    };
  }

  getIdentity(): RuntimeSessionIdentity {
    return { ...this.identity };
  }

  acquireMutationLock(toolName: string): void {
    const current = SessionCoordinator.workspaceLocks.get(this.identity.workspaceFingerprint);
    if (current && current.ownerSessionId !== this.identity.sessionId) {
      const stale = Date.now() - current.acquiredAt > STALE_LOCK_MS;
      throw new ToolExecutionErrorClass(
        ErrorCode.POLICY_DENIED,
        stale ? "Mutation lock is stale and requires manual recovery action" : "Mutation lock held by another runtime session",
        { tool: toolName, retryable: true, details: { ownerSessionId: current.ownerSessionId, stale } }
      );
    }
    if (!current) {
      SessionCoordinator.workspaceLocks.set(this.identity.workspaceFingerprint, {
        ownerSessionId: this.identity.sessionId,
        acquiredAt: Date.now(),
        toolName,
      });
    }
  }

  releaseMutationLock(toolName: string): void {
    const current = SessionCoordinator.workspaceLocks.get(this.identity.workspaceFingerprint);
    if (current && current.ownerSessionId === this.identity.sessionId) {
      SessionCoordinator.workspaceLocks.delete(this.identity.workspaceFingerprint);
    }
    void toolName;
  }

  setExternalLock(lock: MutationLock | null): void {
    if (!lock) {
      SessionCoordinator.workspaceLocks.delete(this.identity.workspaceFingerprint);
      return;
    }
    SessionCoordinator.workspaceLocks.set(this.identity.workspaceFingerprint, lock);
  }

  getCoordinationReport(): {
    session: RuntimeSessionIdentity;
    lockHeld: boolean;
    lockOwnerSessionId?: string;
    staleLock: boolean;
  } {
    const lock = SessionCoordinator.workspaceLocks.get(this.identity.workspaceFingerprint) ?? null;
    const staleLock = Boolean(lock && Date.now() - lock.acquiredAt > STALE_LOCK_MS);
    return {
      session: this.getIdentity(),
      lockHeld: Boolean(lock),
      lockOwnerSessionId: lock?.ownerSessionId,
      staleLock,
    };
  }
}

export const globalSessionCoordinator = new SessionCoordinator();
