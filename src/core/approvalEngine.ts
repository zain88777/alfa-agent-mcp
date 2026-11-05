/**
 * Approval engine — structured approval records with expiry, inheritance, and denial auditing.
 *
 * APPROVAL LIFECYCLE:
 *   Requested → Pending → Approved (or Denied) → Expired or Revoked
 *
 * INHERITANCE RULES:
 *   1. Approval is SCOPED to a requestId chain (requestId + parentRequestId lineage).
 *   2. Child executions inherit parent's approval IF the tool is same tier or lower.
 *   3. A dangerous-tool approval does NOT cascade to nested dangerous tools automatically.
 *      Nested dangerous calls must get their OWN approval unless explicitly approved in the parent scope.
 *   4. Approval reuse across unrelated requestId chains is BLOCKED.
 *   5. Expired approvals are treated as never-granted.
 *
 * BYPASS PREVENTION:
 *   - Direct handler invocation bypasses approval — BLOCKED at registry level.
 *   - Unclassified tools are denied by policy — cannot execute.
 *   - Nested execution without context loses approval — must re-approve.
 *   - Tool chaining that skips registry.execute() — impossible unless direct handler called.
 *   - Approval reuse after expiry — blocked by expiry check.
 *   - Approval reuse across unrelated requestId chains — blocked by scope check.
 */

import { randomUUID } from "crypto";
import { PolicyTier } from "./policyEngine.js";
import { globalToolLogger } from "./toolLogger.js";
import { ErrorCode, ToolExecutionErrorClass } from "./errorResponse.js";
import { loadRuntimeConfig } from "./runtimeConfig.js";
import { globalAuditTrail } from "./auditTrail.js";

/**
 * Sensitive-key patterns that must be redacted from approval input summaries.
 * These are checked case-insensitively against JSON property keys.
 */
const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /api[-_]?key/i,
  /token/i,
  /password/i,
  /secret/i,
  /auth/i,
  /credential/i,
  /private[-_]?key/i,
  /^key$/i,
  /^api$/i,
];

/**
 * Approval status.
 */
export enum ApprovalStatus {
  PENDING = "pending",
  APPROVED = "approved",
  DENIED = "denied",
  EXPIRED = "expired",
  REVOKED = "revoked",
}

/**
 * Structured approval record.
 */
export interface ApprovalRecord {
  /** Unique approval ID */
  id: string;
  /** Request ID this approval belongs to */
  requestId: string;
  /** Parent request ID for inheritance chain */
  parentRequestId?: string;
  /** Tool name */
  toolName: string;
  /** Policy tier at time of approval */
  policyTier: PolicyTier;
  /** Summary of input (not raw secrets — truncated to 200 chars) */
  inputSummary: string;
  /** Current status */
  status: ApprovalStatus;
  /** When the approval was created */
  createdAt: number;
  /** When the approval expires (auto-denies after this) */
  expiresAt: number;
  /** Reason for approval/denial */
  reason?: string;
  /** Who approved/denied */
  approvedBy?: string;
  deniedBy?: string;
  /** Scope — which chain of requestIds this applies to */
  scopeKey: string;
  sessionId?: string;
}

/**
 * Approval configuration.
 */
export interface ApprovalConfig {
  /** Default approval expiry in ms (default: 5 minutes) */
  approvalExpiryMs: number;
  /** Maximum number of pending approvals */
  maxPendingApprovals: number;
  /** Whether to auto-expire approvals on garbage collection */
  enableAutoExpiry: boolean;
}

function getDefaultApprovalConfig(): ApprovalConfig {
  const cfg = loadRuntimeConfig();
  return {
    approvalExpiryMs: cfg.policy.approvalExpiryMs,
    maxPendingApprovals: 100,
    enableAutoExpiry: true,
  };
}

/**
 * Build a scope key from requestId + parentRequestId.
 * This scopes approval to a specific execution chain.
 * Two different chains with different requestIds cannot share approvals.
 */
function buildScopeKey(requestId: string, parentRequestId?: string): string {
  return parentRequestId
    ? `${parentRequestId}:${requestId}`
    : `root:${requestId}`;
}

/**
 * Redact sensitive values from JSON-serializable objects.
 * Replaces values of known sensitive keys with '[REDACTED]'.
 * Works recursively on nested objects and arrays.
 */
function redactSensitive(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input !== "object") return input;

  if (Array.isArray(input)) {
    return input.map(redactSensitive);
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    // Check if this key matches any sensitive pattern
    const isSensitive = SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(key));
    if (isSensitive && typeof value === "string") {
      redacted[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      redacted[key] = redactSensitive(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

/**
 * Truncate input to a safe summary length for audit logs.
 * Never logs raw secrets — sensitive keys are redacted first.
 */
function safeInputSummary(input: unknown): string {
  const redacted = redactSensitive(input);
  const raw = JSON.stringify(redacted);
  if (raw.length <= 200) return raw;
  return raw.substring(0, 197) + "...";
}

/**
 * Approval engine with structured records, expiry, and scoped inheritance.
 */
export class ApprovalEngine {
  private records: ApprovalRecord[] = [];
  private config: ApprovalConfig;
  private onChange?: () => void | Promise<void>;

  constructor(config?: Partial<ApprovalConfig>) {
    this.config = { ...getDefaultApprovalConfig(), ...config };
  }

  setOnChange(handler?: () => void | Promise<void>): void {
    this.onChange = handler;
  }

  private triggerChange(): void {
    if (!this.onChange) return;
    void Promise.resolve(this.onChange()).catch(() => {
      // Best-effort persistence hook; approval flow must remain non-blocking.
    });
  }

  /**
   * Submit a new approval request.
   */
  request(
    requestId: string,
    toolName: string,
    policyTier: PolicyTier,
    input: unknown,
    parentRequestId?: string,
    sessionId?: string
  ): ApprovalRecord {
    // Check pending limit
    const pendingCount = this.records.filter(r => r.status === ApprovalStatus.PENDING).length;
    if (pendingCount >= this.config.maxPendingApprovals) {
      throw new ToolExecutionErrorClass(
        ErrorCode.POLICY_DENIED,
        `Too many pending approvals (${pendingCount}/${this.config.maxPendingApprovals}). Resolve pending requests first.`,
        { tool: toolName }
      );
    }

    const record: ApprovalRecord = {
      id: randomUUID(),
      requestId,
      parentRequestId,
      toolName,
      policyTier,
      inputSummary: safeInputSummary(input),
      status: ApprovalStatus.PENDING,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.config.approvalExpiryMs,
      scopeKey: buildScopeKey(requestId, parentRequestId),
      sessionId,
    };

    this.records.push(record);
    globalAuditTrail.record("approval", "request", { approvalId: record.id, toolName, policyTier, requestId, sessionId });
    this.triggerChange();
    return record;
  }

  /**
   * Approve a pending request.
   */
  approve(approvalId: string, approvedBy?: string): ApprovalRecord | null {
    const record = this.getRecord(approvalId);
    if (!record) return null;

    if (record.status !== ApprovalStatus.PENDING) {
      return null; // Cannot approve non-pending
    }

    // Check expiry
    if (this.config.enableAutoExpiry && Date.now() > record.expiresAt) {
      record.status = ApprovalStatus.EXPIRED;
      return null;
    }

    record.status = ApprovalStatus.APPROVED;
    record.approvedBy = approvedBy;
    globalAuditTrail.record("approval", "approve", { approvalId: record.id, toolName: record.toolName, requestId: record.requestId, sessionId: record.sessionId });
    this.triggerChange();
    return record;
  }

  /**
   * Deny a pending request.
   */
  deny(approvalId: string, reason: string, deniedBy?: string): ApprovalRecord | null {
    const record = this.getRecord(approvalId);
    if (!record) return null;

    if (record.status !== ApprovalStatus.PENDING) {
      return null;
    }

    record.status = ApprovalStatus.DENIED;
    record.reason = reason;
    record.deniedBy = deniedBy;

    // Audit denial
    this.auditDenial(record);
    globalAuditTrail.record("approval", "deny", { approvalId: record.id, toolName: record.toolName, requestId: record.requestId, sessionId: record.sessionId });
    this.triggerChange();

    return record;
  }

  /**
   * Check if a specific execution has a valid (non-expired) approval.
   *
   * INHERITANCE RULES APPLIED HERE:
   * 1. Check for direct approval matching requestId + toolName
   * 2. Check for parent-scope approval that covers this tool's tier
   * 3. Check for approval in the lineage chain (parentRequestId trace)
   * 4. Expired approvals are treated as non-existent
   * 5. Approval reuse across unrelated requestId chains is blocked
   *
   * INHERITED APPROVAL RESTRICTION:
   * Dangerous tools do NOT inherit approval from parent scope automatically.
   * Only safe_write or lower can inherit. Dangerous+ must get own approval.
   */
  hasApproval(
    requestId: string,
    toolName: string,
    policyTier: PolicyTier,
    parentRequestId?: string,
    sessionId?: string
  ): boolean {
    this.expireStale();

    // Build possible scope keys for this execution
    const directScope = buildScopeKey(requestId, parentRequestId);
    const parentScope = parentRequestId
      ? buildScopeKey(parentRequestId, undefined)
      : null;

    // Check all records for valid approvals
    for (const record of this.records) {
      if (record.status !== ApprovalStatus.APPROVED) continue;
      if (sessionId && record.sessionId && record.sessionId !== sessionId) continue;
      if (Date.now() > record.expiresAt) {
        record.status = ApprovalStatus.EXPIRED;
        continue;
      }

      // Check direct scope match
      if (record.scopeKey === directScope && record.toolName === toolName) {
        return true;
      }

      // Check parent scope inheritance
      if (parentScope && record.scopeKey === parentScope) {
        // INHERITANCE RESTRICTION: dangerous tools do NOT inherit parent approval
        if (policyTier === PolicyTier.DANGEROUS || policyTier === PolicyTier.SYSTEM_SENSITIVE) {
          continue; // dangerous+ tools must get own approval
        }
        // Parent approval must cover the requested tier
        if (this.doesTierCover(record.policyTier, policyTier)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if an approval tier covers a requested tier.
   * Read-only approval does NOT cover dangerous.
   * Dangerous approval covers everything below it.
   */
  private doesTierCover(approvalTier: PolicyTier, requestedTier: PolicyTier): boolean {
    const order = [PolicyTier.READ_ONLY, PolicyTier.SAFE_WRITE, PolicyTier.DANGEROUS, PolicyTier.SYSTEM_SENSITIVE];
    return order.indexOf(approvalTier) >= order.indexOf(requestedTier);
  }

  /**
   * Get all approval records.
   */
  list(): ApprovalRecord[] {
    this.expireStale();
    return [...this.records];
  }

  /**
   * Get pending approval records.
   */
  listPending(): ApprovalRecord[] {
    this.expireStale();
    return this.records.filter(r => r.status === ApprovalStatus.PENDING);
  }

  /**
   * Get a specific record by ID.
   */
  getRecord(id: string): ApprovalRecord | undefined {
    return this.records.find(r => r.id === id);
  }

  /**
   * Clear all records.
   */
  clear(): void {
    this.records = [];
    this.triggerChange();
  }

  /**
   * Clear expired records.
   */
  clearExpired(): void {
    this.expireStale();
    this.records = this.records.filter(r => r.status !== ApprovalStatus.EXPIRED);
  }

  /**
   * Revoke an approval (prevents reuse).
   */
  revoke(approvalId: string): boolean {
    const record = this.getRecord(approvalId);
    if (!record) return false;
    if (record.status === ApprovalStatus.APPROVED) {
      record.status = ApprovalStatus.REVOKED;
      globalAuditTrail.record("approval", "revoke", { approvalId: record.id, toolName: record.toolName, requestId: record.requestId, sessionId: record.sessionId });
      this.triggerChange();
      return true;
    }
    return false;
  }

  /**
   * Expire stale records based on time.
   */
  private expireStale(): void {
    if (!this.config.enableAutoExpiry) return;
    const now = Date.now();
    for (const record of this.records) {
      if (record.status === ApprovalStatus.PENDING || record.status === ApprovalStatus.APPROVED) {
        if (now > record.expiresAt) {
          record.status = ApprovalStatus.EXPIRED;
        }
      }
    }
  }

  /**
   * Audit log a denial.
   * Only logs: tool name, requestId, policy tier, denial reason, timestamp, input summary (not raw secrets).
   */
  private auditDenial(record: ApprovalRecord): void {
    globalToolLogger.startExecution(
      `approval_denial`,
      JSON.stringify({
        toolName: record.toolName,
        requestId: record.requestId,
        tier: record.policyTier,
        reason: record.reason,
        inputSummary: record.inputSummary,
      }).length
    );
  }

  /**
   * Get config
   */
  getConfig(): ApprovalConfig {
    return { ...this.config };
  }

  /**
   * Update config
   */
  updateConfig(partial: Partial<ApprovalConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  exportSafeRecords(): Array<{
    id: string;
    requestId: string;
    parentRequestId?: string;
    toolName: string;
    policyTier: PolicyTier;
    status: ApprovalStatus;
    createdAt: number;
    expiresAt: number;
    reason?: string;
    sessionId?: string;
  }> {
    this.expireStale();
    return this.records.map((r) => ({
      id: r.id,
      requestId: r.requestId,
      parentRequestId: r.parentRequestId,
      toolName: r.toolName,
      policyTier: r.policyTier,
      status: r.status,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      reason: r.reason,
      sessionId: r.sessionId,
    }));
  }

  importSafeRecords(records: Array<{
    id: string;
    requestId: string;
    parentRequestId?: string;
    toolName: string;
    policyTier: PolicyTier;
    status: ApprovalStatus;
    createdAt: number;
    expiresAt: number;
    reason?: string;
    sessionId?: string;
  }>, options: { triggerChange?: boolean } = {}): void {
    const { triggerChange = true } = options;
    this.records = records.map((r) => ({
      ...r,
      inputSummary: "{}",
      scopeKey: buildScopeKey(r.requestId, r.parentRequestId),
    }));
    this.expireStale();
    if (triggerChange) this.triggerChange();
  }
}
