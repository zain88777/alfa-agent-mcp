import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getWorkspaceRoot } from "./workspaceContext.js";
import { ToolExecutionErrorClass, ErrorCode } from "./errorResponse.js";

const AUDIT_SCHEMA_VERSION = "1.0.0";
const AUDIT_FILE = ".alfa-agent/runtime-audit-log.json";
const MAX_AUDIT_EVENTS = 2000;

export type AuditEventType = "plan" | "tool" | "provider" | "approval" | "quota" | "transaction" | "recovery" | "checkpoint";

export interface AuditEvent {
  seq: number;
  timestamp: string;
  type: AuditEventType;
  action: string;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface AuditLogExport {
  schemaVersion: string;
  createdAt: string;
  eventCount: number;
  chainTip: string;
  checksum: string;
  events: AuditEvent[];
}

export interface ReplaySummary {
  eventCount: number;
  chainValid: boolean;
  typeCounts: Record<string, number>;
  plan: { started: number; completed: number; failed: number; stepsStarted: number; stepsCompleted: number; stepsFailed: number };
  tools: { started: number; succeeded: number; failed: number };
  providers: { started: number; succeeded: number; failed: number };
  approvals: { requested: number; approved: number; denied: number; revoked: number };
  quotas: { checks: number; violations: number };
  transactions: { started: number; committed: number; rolledBack: number; failed: number };
  recovery: { actions: number };
  checkpoints: { exported: number; imported: number };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function hashOf(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function sanitizeValue(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input === "string") {
    let out = input;
    const patterns = [
      /sk-[A-Za-z0-9_-]{8,}/g,
      /api[_-]?key\s*[:=]\s*[^,\s]+/gi,
      /token\s*[:=]\s*[^,\s]+/gi,
      /password\s*[:=]\s*[^,\s]+/gi,
      /secret\s*[:=]\s*[^,\s]+/gi,
      /(^[A-Za-z]:\\|^\/(?:Users|home|root|etc|var)\/)/g,
      /(?:npm\s+run|powershell\s+-|cmd\s*\/c)/gi,
    ];
    for (const p of patterns) out = out.replace(p, "[REDACTED]");
    return out.length > 300 ? `${out.slice(0, 300)}...` : out;
  }
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map(sanitizeValue);
  const obj = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/(prompt|rawprompt|command|rawcommand|content|env|apikey|token|secret|password)/i.test(k)) {
      out[k] = "[REDACTED]";
      continue;
    }
    out[k] = sanitizeValue(v);
  }
  return out;
}

function resolveAuditPath(filePath?: string): string {
  const root = getWorkspaceRoot();
  const rel = filePath && filePath.trim().length > 0 ? filePath : AUDIT_FILE;
  const resolved = path.resolve(root, rel);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ToolExecutionErrorClass(ErrorCode.PATH_DENIED, "Audit log path must stay within workspace root", { tool: "audit_log", retryable: false });
  }
  return resolved;
}

class AuditTrail {
  private events: AuditEvent[] = [];
  private seq = 0;

  record(type: AuditEventType, action: string, payload?: Record<string, unknown>): AuditEvent {
    const safePayload = sanitizeValue(payload ?? {}) as Record<string, unknown>;
    const prevHash = this.events.length > 0 ? this.events[this.events.length - 1].hash : "GENESIS";
    const seq = ++this.seq;
    const timestamp = new Date().toISOString();
    const core = { seq, timestamp, type, action, payload: safePayload, prevHash };
    const event: AuditEvent = {
      ...core,
      hash: hashOf(core),
    };
    this.events.push(event);
    if (this.events.length > MAX_AUDIT_EVENTS) {
      this.events.shift();
    }
    return event;
  }

  snapshot(): AuditEvent[] {
    return this.events.map((e) => ({ ...e, payload: { ...e.payload } }));
  }

  clear(): void {
    this.events = [];
    this.seq = 0;
  }

  buildExport(events = this.snapshot()): AuditLogExport {
    const chainTip = events.length > 0 ? events[events.length - 1].hash : "GENESIS";
    return {
      schemaVersion: AUDIT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      eventCount: events.length,
      chainTip,
      checksum: hashOf(events),
      events,
    };
  }

  verify(events = this.snapshot()): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    let prev = "GENESIS";
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.prevHash !== prev) {
        errors.push(`prevHash mismatch at seq ${e.seq}`);
      }
      const expected = hashOf({ seq: e.seq, timestamp: e.timestamp, type: e.type, action: e.action, payload: e.payload, prevHash: e.prevHash });
      if (e.hash !== expected) {
        errors.push(`hash mismatch at seq ${e.seq}`);
      }
      prev = e.hash;
    }
    return { valid: errors.length === 0, errors };
  }
}

export const globalAuditTrail = new AuditTrail();

export function simulateReplay(events: AuditEvent[]): ReplaySummary {
  const typeCounts: Record<string, number> = {};
  const s: ReplaySummary = {
    eventCount: events.length,
    chainValid: globalAuditTrail.verify(events).valid,
    typeCounts,
    plan: { started: 0, completed: 0, failed: 0, stepsStarted: 0, stepsCompleted: 0, stepsFailed: 0 },
    tools: { started: 0, succeeded: 0, failed: 0 },
    providers: { started: 0, succeeded: 0, failed: 0 },
    approvals: { requested: 0, approved: 0, denied: 0, revoked: 0 },
    quotas: { checks: 0, violations: 0 },
    transactions: { started: 0, committed: 0, rolledBack: 0, failed: 0 },
    recovery: { actions: 0 },
    checkpoints: { exported: 0, imported: 0 },
  };

  for (const e of events) {
    typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
    if (e.type === "plan") {
      if (e.action === "start") s.plan.started++;
      if (e.action === "complete") s.plan.completed++;
      if (e.action === "fail") s.plan.failed++;
      if (e.action === "step_start") s.plan.stepsStarted++;
      if (e.action === "step_success") s.plan.stepsCompleted++;
      if (e.action === "step_fail") s.plan.stepsFailed++;
    }
    if (e.type === "tool") {
      if (e.action === "start") s.tools.started++;
      if (e.action === "success") s.tools.succeeded++;
      if (e.action === "failure") s.tools.failed++;
    }
    if (e.type === "provider") {
      if (e.action === "start") s.providers.started++;
      if (e.action === "success") s.providers.succeeded++;
      if (e.action === "failure") s.providers.failed++;
    }
    if (e.type === "approval") {
      if (e.action === "request") s.approvals.requested++;
      if (e.action === "approve") s.approvals.approved++;
      if (e.action === "deny") s.approvals.denied++;
      if (e.action === "revoke") s.approvals.revoked++;
    }
    if (e.type === "quota") {
      if (e.action === "check") s.quotas.checks++;
      if (e.action === "violation") s.quotas.violations++;
    }
    if (e.type === "transaction") {
      if (e.action === "start") s.transactions.started++;
      if (e.action === "commit") s.transactions.committed++;
      if (e.action === "rollback") s.transactions.rolledBack++;
      if (e.action === "fail") s.transactions.failed++;
    }
    if (e.type === "recovery") s.recovery.actions++;
    if (e.type === "checkpoint") {
      if (e.action === "export") s.checkpoints.exported++;
      if (e.action === "import") s.checkpoints.imported++;
    }
  }

  return s;
}

export async function exportAuditLog(filePath?: string): Promise<{ path: string; log: AuditLogExport }> {
  const resolved = resolveAuditPath(filePath);
  const log = globalAuditTrail.buildExport();
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, JSON.stringify(log, null, 2), "utf8");
  return { path: resolved, log };
}

export async function readAuditLog(filePath?: string): Promise<AuditLogExport> {
  const resolved = resolveAuditPath(filePath);
  let raw = "";
  try {
    raw = await fs.readFile(resolved, "utf8");
  } catch (e) {
    throw new ToolExecutionErrorClass(ErrorCode.VALIDATION_FAILED, `Failed to read audit log: ${(e as Error).message}`, { tool: "audit_log", retryable: false });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ToolExecutionErrorClass(ErrorCode.VALIDATION_FAILED, "Malformed audit log JSON", { tool: "audit_log", retryable: false });
  }
  const p = parsed as Partial<AuditLogExport>;
  if (p.schemaVersion !== AUDIT_SCHEMA_VERSION || !Array.isArray(p.events)) {
    throw new ToolExecutionErrorClass(ErrorCode.VALIDATION_FAILED, "Invalid audit log schema", { tool: "audit_log", retryable: false });
  }
  const checksum = hashOf(p.events);
  if (checksum !== p.checksum) {
    throw new ToolExecutionErrorClass(ErrorCode.VALIDATION_FAILED, "Audit log checksum mismatch", { tool: "audit_log", retryable: false });
  }
  return {
    schemaVersion: p.schemaVersion,
    createdAt: String(p.createdAt ?? ""),
    eventCount: Number(p.eventCount ?? p.events.length),
    chainTip: String(p.chainTip ?? "GENESIS"),
    checksum: String(p.checksum),
    events: p.events as AuditEvent[],
  };
}

export async function verifyAuditLog(filePath?: string): Promise<{ valid: boolean; errors: string[]; eventCount: number }> {
  const log = filePath ? await readAuditLog(filePath) : globalAuditTrail.buildExport();
  const verification = globalAuditTrail.verify(log.events);
  return {
    valid: verification.valid,
    errors: verification.errors,
    eventCount: log.events.length,
  };
}
