import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { ToolRegistry } from "./toolRegistry.js";
import { getWorkspaceRoot } from "./workspaceContext.js";
import { globalTransactionEngine } from "./transactionEngine.js";
import { globalObservability } from "./observability.js";
import { ToolExecutionErrorClass, ErrorCode } from "./errorResponse.js";
import { globalSessionCoordinator } from "./sessionCoordinator.js";

const STATE_DIR = ".alfa-agent/state";
const STATE_FILE = "runtime-state.json";
const STATE_SCHEMA_VERSION = "1.0.0";

const persistedSchema = z.object({
  schemaVersion: z.string(),
  createdAt: z.string(),
  checksum: z.string(),
  data: z.object({
    checkpointMetadata: z.object({
      schemaVersion: z.string(),
      createdAt: z.string(),
      checksum: z.string(),
    }).optional(),
    sessionIdentity: z.object({
      sessionId: z.string(),
      createdAt: z.number(),
      workspaceLabel: z.string(),
      workspaceFingerprint: z.string(),
      status: z.string(),
    }).optional(),
    transactionSummaries: z.array(z.object({
      id: z.string(),
      sessionId: z.string().optional(),
      status: z.string(),
      createdAt: z.number(),
      stepCount: z.number(),
      rollbackEligible: z.boolean(),
    })),
    approvalRecords: z.array(z.object({
      id: z.string(),
      requestId: z.string(),
      parentRequestId: z.string().optional(),
      toolName: z.string(),
      policyTier: z.string(),
      status: z.string(),
      createdAt: z.number(),
      expiresAt: z.number(),
      reason: z.string().optional(),
      sessionId: z.string().optional(),
    })),
    recoveryReadiness: z.unknown(),
    metricsSummary: z.unknown(),
    quotaSummary: z.unknown(),
    cacheSummary: z.unknown(),
    configSummary: z.unknown(),
  }),
});

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function hashData(data: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(data)).digest("hex");
}

function resolveStatePath(): string {
  return path.resolve(getWorkspaceRoot(), STATE_DIR, STATE_FILE);
}

async function quarantineCorruptState(filePath: string): Promise<void> {
  const q = `${filePath}.corrupt-${Date.now()}`;
  try {
    await fs.rename(filePath, q);
  } catch {
    // ignore quarantine failure
  }
}

export async function persistRuntimeState(registry: ToolRegistry, checkpointMeta?: { schemaVersion: string; createdAt: string; checksum: string }): Promise<void> {
  const filePath = resolveStatePath();
  const snapshot = globalObservability.getSnapshot();
  const data = {
    checkpointMetadata: checkpointMeta,
    sessionIdentity: globalSessionCoordinator.getIdentity(),
    transactionSummaries: globalTransactionEngine.exportSafeSessionSummaries(),
    approvalRecords: registry.getApprovalEngine().exportSafeRecords(),
    recoveryReadiness: {
      pendingApprovals: registry.getApprovalEngine().listPending().length,
      failedSessions: globalTransactionEngine.getRecoverySummary().failedSessions,
      rollbackEligibleSessions: globalTransactionEngine.getRecoverySummary().rollbackEligibleSessions,
      recentErrors: snapshot.recentTraces.filter((t) => t.status === "failure").slice(-20).map((t) => ({ timestamp: t.timestamp, errorCode: t.errorCode })),
      quotaViolations: snapshot.quota.violations,
    },
    metricsSummary: {
      totalExecutions: snapshot.totalExecutions,
      successCount: snapshot.successCount,
      failureCount: snapshot.failureCount,
      errorCountsByCode: snapshot.errorCountsByCode,
    },
    quotaSummary: snapshot.quota,
    cacheSummary: snapshot.cache,
    configSummary: {
      debugMode: false,
      safeForDisplay: true,
    },
  };
  const serializable = JSON.parse(JSON.stringify(data));
  const payload = {
    schemaVersion: STATE_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    checksum: hashData(serializable),
    data: serializable,
  };

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

export async function restoreRuntimeState(registry: ToolRegistry): Promise<{ restored: boolean; quarantined: boolean }> {
  const filePath = resolveStatePath();
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    return { restored: false, quarantined: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await quarantineCorruptState(filePath);
    return { restored: false, quarantined: true };
  }

  const result = persistedSchema.safeParse(parsed);
  if (!result.success) {
    await quarantineCorruptState(filePath);
    return { restored: false, quarantined: true };
  }

  if (result.data.schemaVersion !== STATE_SCHEMA_VERSION || result.data.checksum !== hashData(result.data.data)) {
    await quarantineCorruptState(filePath);
    return { restored: false, quarantined: true };
  }

  const approvals = result.data.data.approvalRecords.map((r) => ({
    ...r,
    policyTier: r.policyTier as never,
    status: r.status as never,
  }));
  registry.getApprovalEngine().importSafeRecords(approvals);
  globalTransactionEngine.importSafeSessionSummaries(result.data.data.transactionSummaries as never);
  return { restored: true, quarantined: false };
}

export async function readPersistedStateForReport(): Promise<unknown | null> {
  const filePath = resolveStatePath();
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const result = persistedSchema.safeParse(parsed);
    if (!result.success) return null;
    return result.data;
  } catch {
    return null;
  }
}

export function ensureSafeImportPayload(input: unknown): void {
  const raw = JSON.stringify(input);
  if (/sk-[A-Za-z0-9_-]{8,}|[A-Za-z]:\\Users\\|\/Users\/|npm run|powershell -|cmd \/c/i.test(raw)) {
    throw new ToolExecutionErrorClass(ErrorCode.VALIDATION_FAILED, "Unsafe persistence payload detected", { tool: "runtime_persistence", retryable: false });
  }
}
