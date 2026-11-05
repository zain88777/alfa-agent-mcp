import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRegistry } from "../src/core/toolLoader.js";
import { buildRuntimeSnapshot } from "../src/core/runtimeSnapshot.js";
import { globalObservability } from "../src/core/observability.js";
import { globalTransactionEngine } from "../src/core/transactionEngine.js";
import { runRuntimeSnapshot } from "../src/cli.js";

describe("P7.1 Runtime State Snapshot & Recovery", () => {
  beforeEach(() => {
    globalObservability.reset();
    globalTransactionEngine.reset();
  });

  it("snapshot shape includes required sections", () => {
    const registry = createRegistry();
    const snap = buildRuntimeSnapshot(registry);
    assert.ok(snap.health);
    assert.ok(snap.policyCoverage);
    assert.ok(snap.approvals);
    assert.ok(snap.activeTraces);
    assert.ok(snap.metrics);
    assert.ok(snap.quota);
    assert.ok(snap.cache);
    assert.ok(snap.transactions);
    assert.ok(snap.configSummary);
    assert.ok(snap.recoveryReadiness);
  });

  it("config summary is redacted and path-safe", () => {
    process.env.LLM_API_KEY = "test-api-key-placeholder";
    const registry = createRegistry();
    const snap = buildRuntimeSnapshot(registry);
    const dump = JSON.stringify(snap);
    assert.equal(dump.includes("test-api-key-placeholder"), false);
    assert.equal(dump.includes("workspaceRoot"), false);
    assert.equal(dump.includes("C:\\Users\\"), false);
  });

  it("transaction summary captures active/failed/rollback-eligible", () => {
    const s1 = globalTransactionEngine.createSession("active");
    const s2 = globalTransactionEngine.createSession("failed");
    globalTransactionEngine.recordStep(s1.id, "write_file", "write", ["a.ts"], "preview", "backup-a");
    globalTransactionEngine.recordStep(s2.id, "write_file", "write", ["b.ts"], "preview", "backup-b");
    globalTransactionEngine.markFailed(s2.id, "boom");

    const registry = createRegistry();
    const snap = buildRuntimeSnapshot(registry);
    assert.ok(snap.transactions.activeTransactions >= 1);
    assert.ok(snap.transactions.failedSessions >= 1);
    assert.ok(snap.transactions.rollbackEligibleSessions >= 1);
  });

  it("approval summary includes pending approvals", async () => {
    const registry = createRegistry();
    await assert.rejects(() => registry.execute("git_status", {}, "p7-approval"));
    const snap = buildRuntimeSnapshot(registry);
    assert.ok(snap.approvals.pending >= 1);
    assert.ok(snap.recoveryReadiness.pendingApprovals >= 1);
  });

  it("quota/cache/metrics are included", () => {
    const registry = createRegistry();
    globalObservability.recordQuotaCheck({
      type: "maxToolCalls",
      requestId: "p7",
      passed: false,
      actual: 4,
      limit: 3,
      timestamp: Date.now(),
    });
    const snap = buildRuntimeSnapshot(registry);
    assert.ok(typeof snap.quota.checks === "number");
    assert.ok(typeof snap.cache.entries === "number");
    assert.ok(typeof snap.metrics.totalExecutions === "number");
  });

  it("snapshot does not leak absolute paths or command strings", async () => {
    const registry = createRegistry();
    globalObservability.recordToolExecution({
      toolName: "run_command",
      trace: { traceId: "t1", requestId: "r1", toolName: "run_command" },
      success: true,
      durationMs: 10,
    });
    const snap = buildRuntimeSnapshot(registry);
    const dump = JSON.stringify(snap);
    assert.equal(dump.includes("npm run"), false);
    assert.equal(dump.includes("C:\\Users\\"), false);
    assert.equal(/\/Users\/|\/home\//.test(dump), false);
  });

  it("runtime:snapshot CLI command path exits zero", async () => {
    const exitCode = await runRuntimeSnapshot();
    assert.equal(exitCode, 0);
  });
});
