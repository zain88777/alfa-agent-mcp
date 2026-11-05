import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { ToolExecutionErrorClass, ErrorCode } from "./errorResponse.js";
import { ToolRegistry } from "./toolRegistry.js";
import { buildRuntimeSnapshot } from "./runtimeSnapshot.js";
import { getWorkspaceRoot } from "./workspaceContext.js";
import { globalTransactionEngine } from "./transactionEngine.js";
import { globalAuditTrail } from "./auditTrail.js";

const CHECKPOINT_SCHEMA_VERSION = "1.0.0";
const DEFAULT_CHECKPOINT_FILE = ".alfa-agent/runtime-checkpoint.json";

const unsafeKeyPattern = /(rawCommand|commandString|rawEnv)/i;
const unsafeValuePattern = /(sk-[A-Za-z0-9_-]{8,}|api[_-]?key\s*[:=]\s*\S+|token\s*[:=]\s*\S+|password\s*[:=]\s*\S+|secret\s*[:=]\s*\S+|npm\s+run\s+|powershell\s+-|cmd\s*\/c)/i;
const absolutePathPattern = /(^[A-Za-z]:\\|^\/(?:Users|home|root|etc|var)\/)/;

const checkpointDataSchema = z.object({
  transactionSummary: z.unknown(),
  approvals: z.array(z.object({
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
  }).strict()),
  cache: z.object({
    entries: z.number(),
    maxEntries: z.number(),
    ttlMs: z.number(),
    hitRatio: z.number(),
    metrics: z.object({
      hits: z.number(),
      misses: z.number(),
      evictions: z.number(),
      invalidations: z.number(),
    }),
  }),
  metricsSummary: z.object({
    runtimeStatus: z.string(),
    totalExecutions: z.number(),
    successCount: z.number(),
    failureCount: z.number(),
    errorCountsByCode: z.record(z.number()),
    activeTraces: z.number(),
  }),
  quota: z.object({
    checks: z.number(),
    violations: z.number(),
    recentChecks: z.array(z.unknown()),
  }),
  configSummary: z.unknown(),
}).strict();

const checkpointSchema = z.object({
  schemaVersion: z.string(),
  createdAt: z.string(),
  runtimeVersion: z.string(),
  checksum: z.string(),
  data: checkpointDataSchema,
}).strict();

type RuntimeCheckpoint = z.infer<typeof checkpointSchema>;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function checksumForData(data: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(data)).digest("hex");
}

function resolveCheckpointPath(filePath?: string): string {
  const workspaceRoot = getWorkspaceRoot();
  const relative = filePath && filePath.trim().length > 0 ? filePath : DEFAULT_CHECKPOINT_FILE;
  const resolved = path.resolve(workspaceRoot, relative);
  const rel = path.relative(workspaceRoot, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new ToolExecutionErrorClass(
      ErrorCode.PATH_DENIED,
      "Checkpoint path must stay within workspace root",
      { tool: "checkpoint", retryable: false }
    );
  }
  return resolved;
}

function assertNoUnsafeContent(value: unknown): void {
  const visit = (v: unknown): void => {
    if (v === null || v === undefined) return;
    if (typeof v === "string") {
      if (absolutePathPattern.test(v) || unsafeValuePattern.test(v)) {
        throw new ToolExecutionErrorClass(
          ErrorCode.VALIDATION_FAILED,
          "Checkpoint contains unsafe content",
          { tool: "checkpoint", retryable: false }
        );
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    if (typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (unsafeKeyPattern.test(k)) {
          throw new ToolExecutionErrorClass(
            ErrorCode.VALIDATION_FAILED,
            `Checkpoint contains unsafe key: ${k}`,
            { tool: "checkpoint", retryable: false }
          );
        }
        visit(val);
      }
    }
  };
  visit(value);
}

function toCheckpoint(registry: ToolRegistry): RuntimeCheckpoint {
  const snapshot = buildRuntimeSnapshot(registry);
  const approvals = registry.getApprovalEngine().list().map((a) => ({
    id: a.id,
    requestId: a.requestId,
    parentRequestId: a.parentRequestId,
    toolName: a.toolName,
    policyTier: a.policyTier,
    status: a.status,
    createdAt: a.createdAt,
    expiresAt: a.expiresAt,
    reason: a.reason,
  }));
  const data = {
    transactionSummary: snapshot.transactions,
    approvals,
    cache: {
      entries: snapshot.cache.entries,
      maxEntries: snapshot.cache.maxEntries,
      ttlMs: snapshot.cache.ttlMs,
      hitRatio: snapshot.cache.hitRatio,
      metrics: {
        hits: snapshot.cache.hits,
        misses: snapshot.cache.misses,
        evictions: snapshot.cache.evictions,
        invalidations: snapshot.cache.invalidations,
      },
    },
    metricsSummary: {
      runtimeStatus: snapshot.metrics.runtimeStatus,
      totalExecutions: snapshot.metrics.totalExecutions,
      successCount: snapshot.metrics.successCount,
      failureCount: snapshot.metrics.failureCount,
      errorCountsByCode: snapshot.metrics.errorCountsByCode,
      activeTraces: snapshot.metrics.activeTraces,
    },
    quota: snapshot.quota,
    configSummary: snapshot.configSummary,
  };

  const serializableData = JSON.parse(JSON.stringify(data));
  assertNoUnsafeContent(serializableData);
  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    runtimeVersion: process.env.npm_package_version ?? "unknown",
    checksum: checksumForData(serializableData),
    data: serializableData,
  };
}

export async function exportRuntimeCheckpoint(registry: ToolRegistry, filePath?: string): Promise<{ path: string; checkpoint: RuntimeCheckpoint }> {
  const checkpoint = toCheckpoint(registry);
  const outPath = resolveCheckpointPath(filePath);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(checkpoint, null, 2), "utf-8");
  globalAuditTrail.record("checkpoint", "export", { schemaVersion: checkpoint.schemaVersion });
  return { path: outPath, checkpoint };
}

export async function importRuntimeCheckpoint(filePath?: string): Promise<RuntimeCheckpoint> {
  const inPath = resolveCheckpointPath(filePath);
  let raw: string;
  try {
    raw = await fs.readFile(inPath, "utf-8");
  } catch (e) {
    throw new ToolExecutionErrorClass(
      ErrorCode.VALIDATION_FAILED,
      `Failed to read checkpoint: ${(e as Error).message}`,
      { tool: "checkpoint", retryable: false }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ToolExecutionErrorClass(
      ErrorCode.VALIDATION_FAILED,
      "Malformed checkpoint JSON",
      { tool: "checkpoint", retryable: false }
    );
  }

  const validated = checkpointSchema.safeParse(parsed);
  if (!validated.success) {
    throw new ToolExecutionErrorClass(
      ErrorCode.VALIDATION_FAILED,
      "Invalid checkpoint schema",
      { tool: "checkpoint", retryable: false, details: { issues: validated.error.issues } }
    );
  }

  const checkpoint = validated.data;
  if (checkpoint.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
    throw new ToolExecutionErrorClass(
      ErrorCode.VALIDATION_FAILED,
      `Unsupported checkpoint schema version: ${checkpoint.schemaVersion}`,
      { tool: "checkpoint", retryable: false }
    );
  }
  const expected = checksumForData(checkpoint.data);
  if (checkpoint.checksum !== expected) {
    throw new ToolExecutionErrorClass(
      ErrorCode.VALIDATION_FAILED,
      "Checkpoint checksum mismatch",
      { tool: "checkpoint", retryable: false }
    );
  }
  assertNoUnsafeContent(checkpoint.data);
  globalAuditTrail.record("checkpoint", "import", { schemaVersion: checkpoint.schemaVersion, event: "validated" });
  return checkpoint;
}

export function applyRuntimeCheckpoint(registry: ToolRegistry, checkpoint: RuntimeCheckpoint): void {
  registry.getApprovalEngine().importSafeRecords(
    checkpoint.data.approvals.map((a) => ({
      ...a,
      policyTier: a.policyTier as never,
      status: a.status as never,
    }))
  );
  const txSummary = checkpoint.data.transactionSummary as { sessions?: unknown };
  if (txSummary && Array.isArray(txSummary.sessions)) {
    const safe = txSummary.sessions
      .filter((s): s is { id: string; status: string; createdAt: number; stepCount: number; rollbackEligible: boolean } =>
        typeof s === "object" && s !== null &&
        typeof (s as { id?: unknown }).id === "string" &&
        typeof (s as { status?: unknown }).status === "string" &&
        typeof (s as { createdAt?: unknown }).createdAt === "number" &&
        typeof (s as { stepCount?: unknown }).stepCount === "number" &&
        typeof (s as { rollbackEligible?: unknown }).rollbackEligible === "boolean"
      )
      .map((s) => ({
        id: s.id,
        status: s.status as never,
        createdAt: s.createdAt,
        stepCount: s.stepCount,
        rollbackEligible: s.rollbackEligible,
      }));
    globalTransactionEngine.importSafeSessionSummaries(safe);
  }
}
