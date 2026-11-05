import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRegistry } from "../src/core/toolLoader.js";
import { exportRuntimeCheckpoint, importRuntimeCheckpoint, applyRuntimeCheckpoint } from "../src/core/runtimeCheckpoint.js";
import { persistRuntimeState, restoreRuntimeState } from "../src/core/runtimePersistence.js";
import { globalTransactionEngine } from "../src/core/transactionEngine.js";
import { SessionCoordinator } from "../src/core/sessionCoordinator.js";
import { buildRecoveryReport, applyRecoveryAction } from "../src/core/runtimeRecovery.js";
import { PolicyTier } from "../src/core/policyEngine.js";
import { runCheckpointExport, runCheckpointImport } from "../src/cli.js";

const workspaceRoot = process.cwd();
const stateFile = path.join(workspaceRoot, ".alfa-agent", "state", "runtime-state.json");
const checkpointFile = path.join(workspaceRoot, ".alfa-agent", "p7-durability-checkpoint.json");

describe("P7 Runtime Durability Layer", () => {
  beforeEach(async () => {
    globalTransactionEngine.reset();
    await fs.mkdir(path.join(workspaceRoot, ".alfa-agent", "state"), { recursive: true });
    await fs.rm(stateFile, { force: true }).catch(() => {});
    await fs.rm(checkpointFile, { force: true }).catch(() => {});
  });

  it("checkpoint import applies safe summaries without command execution", async () => {
    const registry = createRegistry();
    const a = registry.getApprovalEngine().request("req-1", "delete_file", PolicyTier.DANGEROUS, { x: 1 }, undefined, "s1");
    registry.getApprovalEngine().approve(a.id);
    globalTransactionEngine.createSession("demo", "s1");

    await exportRuntimeCheckpoint(registry, ".alfa-agent/p7-durability-checkpoint.json");

    const target = createRegistry();
    const cp = await importRuntimeCheckpoint(".alfa-agent/p7-durability-checkpoint.json");
    applyRuntimeCheckpoint(target, cp);

    assert.equal(target.getApprovalEngine().list().length > 0, true);
    assert.equal(globalTransactionEngine.getRecoverySummary().sessions.length > 0, true);
  });

  it("persistence save/load works and corrupt file is quarantined", async () => {
    const registry = createRegistry();
    await persistRuntimeState(registry);
    const restored = await restoreRuntimeState(registry);
    assert.equal(restored.restored, true);

    await fs.writeFile(stateFile, "{bad", "utf8");
    const bad = await restoreRuntimeState(registry);
    assert.equal(bad.quarantined, true);
  });

  it("recovery report includes stale sessions and rollback-eligible detection", async () => {
    const registry = createRegistry();
    const stale = globalTransactionEngine.createSession("stale", "s1");
    stale.createdAt = Date.now() - (31 * 60 * 1000);
    const rb = globalTransactionEngine.createSession("rb", "s2");
    globalTransactionEngine.recordStep(rb.id, "write_file", "write", ["tmp.txt"], "preview", ".backup/tmp.txt");

    const report = buildRecoveryReport(registry);
    assert.equal(report.staleSessions.includes(stale.id), true);
    assert.equal(report.rollbackEligibleSessions >= 1, true);

    const marked = await applyRecoveryAction("mark_stale_failed", stale.id);
    assert.equal(marked.ok, true);
  });

  it("multi-session lock blocks conflicting mutations and releases correctly", () => {
    const a = new SessionCoordinator("session-a", workspaceRoot);
    const b = new SessionCoordinator("session-b", workspaceRoot);

    a.acquireMutationLock("write_file");
    assert.throws(() => b.acquireMutationLock("delete_file"));
    a.releaseMutationLock("write_file");
    assert.doesNotThrow(() => b.acquireMutationLock("delete_file"));
    b.releaseMutationLock("delete_file");
  });

  it("session isolation: no cross-session approval or transaction leakage", () => {
    const registry = createRegistry();
    const approval = registry.getApprovalEngine().request("r1", "delete_file", PolicyTier.DANGEROUS, {}, undefined, "session-1");
    registry.getApprovalEngine().approve(approval.id);

    const allowedSame = registry.getApprovalEngine().hasApproval("r1", "delete_file", PolicyTier.DANGEROUS, undefined, "session-1");
    const allowedOther = registry.getApprovalEngine().hasApproval("r1", "delete_file", PolicyTier.DANGEROUS, undefined, "session-2");
    assert.equal(allowedSame, true);
    assert.equal(allowedOther, false);

    const tx = globalTransactionEngine.createSession("x", "session-1");
    const summaries = globalTransactionEngine.getRecoverySummary().sessions;
    assert.equal(summaries.some((s) => s.id === tx.id && s.sessionId === "session-1"), true);
    assert.equal(summaries.some((s) => s.id === tx.id && s.sessionId === "session-2"), false);
  });

  it("checkpoint schema rejects unknown dangerous extra fields", async () => {
    const registry = createRegistry();
    const out = await exportRuntimeCheckpoint(registry, ".alfa-agent/p7-durability-checkpoint.json");
    const mutated = {
      ...out.checkpoint,
      data: {
        ...out.checkpoint.data,
        rawCommand: "npm run release:check",
      },
    } as unknown;
    await fs.writeFile(checkpointFile, JSON.stringify(mutated, null, 2), "utf8");
    await assert.rejects(() => importRuntimeCheckpoint(".alfa-agent/p7-durability-checkpoint.json"));
  });

  it("CLI checkpoint export/import still exits zero", async () => {
    const exportCode = await runCheckpointExport(".alfa-agent/p7-durability-checkpoint.json");
    assert.equal(exportCode, 0);
    const importCode = await runCheckpointImport(".alfa-agent/p7-durability-checkpoint.json");
    assert.equal(importCode, 0);
  });
});
