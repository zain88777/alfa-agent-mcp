import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { globalAuditTrail, exportAuditLog, verifyAuditLog, readAuditLog, simulateReplay } from "../src/core/auditTrail.js";
import { runAuditExport, runAuditVerify, runReplaySimulate } from "../src/cli.js";

const workspaceRoot = process.cwd();
const auditFile = path.join(workspaceRoot, ".alfa-agent", "p8.1-audit.json");

describe("P8.1 Deterministic Replay + Signed Audit Trail", () => {
  beforeEach(async () => {
    globalAuditTrail.clear();
    await fs.mkdir(path.dirname(auditFile), { recursive: true });
    await fs.rm(auditFile, { force: true }).catch(() => {});
  });

  it("exports audit log with schema and hash-chain metadata", async () => {
    globalAuditTrail.record("plan", "start", { planId: "p1" });
    globalAuditTrail.record("tool", "start", { toolName: "read_file" });
    const out = await exportAuditLog(".alfa-agent/p8.1-audit.json");
    assert.equal(out.log.schemaVersion, "1.0.0");
    assert.equal(out.log.eventCount, 2);
    assert.ok(out.log.chainTip.length > 20);
    assert.ok(out.log.checksum.length > 20);
  });

  it("verifies untampered hash-chain", async () => {
    globalAuditTrail.record("plan", "start", { planId: "p2" });
    globalAuditTrail.record("plan", "complete", { planId: "p2" });
    await exportAuditLog(".alfa-agent/p8.1-audit.json");
    const verify = await verifyAuditLog(".alfa-agent/p8.1-audit.json");
    assert.equal(verify.valid, true);
    assert.equal(verify.errors.length, 0);
  });

  it("detects tampering through checksum/hash validation", async () => {
    globalAuditTrail.record("tool", "start", { toolName: "x" });
    await exportAuditLog(".alfa-agent/p8.1-audit.json");
    const raw = JSON.parse(await fs.readFile(auditFile, "utf8")) as Record<string, unknown>;
    const events = raw.events as Array<Record<string, unknown>>;
    events[0].action = "mutated";
    await fs.writeFile(auditFile, JSON.stringify(raw, null, 2), "utf8");
    await assert.rejects(() => verifyAuditLog(".alfa-agent/p8.1-audit.json"));
  });

  it("simulates deterministic replay summary from event log", async () => {
    globalAuditTrail.record("plan", "start", { planId: "p3" });
    globalAuditTrail.record("plan", "step_start", { planId: "p3", index: 0 });
    globalAuditTrail.record("plan", "step_success", { planId: "p3", index: 0 });
    globalAuditTrail.record("provider", "start", { provider: "openai" });
    globalAuditTrail.record("provider", "success", { provider: "openai" });
    globalAuditTrail.record("quota", "check", { type: "maxToolCalls" });
    globalAuditTrail.record("transaction", "start", { sessionId: "tx-1" });
    globalAuditTrail.record("checkpoint", "export", { schemaVersion: "1.0.0" });

    const replay = simulateReplay(globalAuditTrail.snapshot());
    assert.equal(replay.plan.started, 1);
    assert.equal(replay.plan.stepsCompleted, 1);
    assert.equal(replay.providers.succeeded, 1);
    assert.equal(replay.quotas.checks, 1);
    assert.equal(replay.transactions.started, 1);
    assert.equal(replay.checkpoints.exported, 1);
    assert.equal(replay.chainValid, true);
  });

  it("redacts secrets, absolute paths, and raw commands in exported audit payloads", async () => {
    globalAuditTrail.record("tool", "start", {
      prompt: "my raw prompt",
      apiKey: "test-api-key-placeholder",
      path: "C:\\Users\\SCO\\secret.txt",
      command: "npm run release:check",
    });

    await exportAuditLog(".alfa-agent/p8.1-audit.json");
    const parsed = await readAuditLog(".alfa-agent/p8.1-audit.json");
    const dump = JSON.stringify(parsed);

    assert.ok(!dump.includes("test-api-key-placeholder"));
    assert.ok(!dump.includes("C:\\Users\\SCO\\secret.txt"));
    assert.ok(!dump.includes("npm run release:check"));
    assert.ok(dump.includes("[REDACTED]"));
  });

  it("CLI audit/replay commands return zero on valid log", async () => {
    globalAuditTrail.record("plan", "start", { planId: "cli" });
    const exportCode = await runAuditExport(".alfa-agent/p8.1-audit.json");
    assert.equal(exportCode, 0);
    const verifyCode = await runAuditVerify(".alfa-agent/p8.1-audit.json");
    assert.equal(verifyCode, 0);
    const replayCode = await runReplaySimulate(".alfa-agent/p8.1-audit.json");
    assert.equal(replayCode, 0);
  });
});
