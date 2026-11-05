import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRegistry } from "../src/core/toolLoader.js";
import { exportRuntimeCheckpoint, importRuntimeCheckpoint } from "../src/core/runtimeCheckpoint.js";
import { runCheckpointExport, runCheckpointImport } from "../src/cli.js";
import { globalObservability } from "../src/core/observability.js";

const workspaceRoot = process.cwd();
const fixtureDir = path.join(workspaceRoot, ".alfa-agent");
const goodFile = path.join(fixtureDir, "p7.2-good.json");
const badFile = path.join(fixtureDir, "p7.2-bad.json");

describe("P7.2 Minimal State Export/Import Checkpoint", () => {
  beforeEach(async () => {
    globalObservability.reset();
    await fs.mkdir(fixtureDir, { recursive: true });
  });

  it("export shape includes version metadata and checksum", async () => {
    const registry = createRegistry();
    const result = await exportRuntimeCheckpoint(registry, ".alfa-agent/p7.2-good.json");
    assert.equal(result.checkpoint.schemaVersion, "1.0.0");
    assert.ok(result.checkpoint.createdAt.length > 0);
    assert.ok(result.checkpoint.runtimeVersion.length > 0);
    assert.ok(result.checkpoint.checksum.length > 10);
    assert.ok(result.checkpoint.data.transactionSummary);
    assert.ok(result.checkpoint.data.metricsSummary);
    assert.ok(result.checkpoint.data.quota);
    assert.ok(result.checkpoint.data.configSummary);
  });

  it("import accepts valid checkpoint", async () => {
    const registry = createRegistry();
    await exportRuntimeCheckpoint(registry, ".alfa-agent/p7.2-good.json");
    const imported = await importRuntimeCheckpoint(".alfa-agent/p7.2-good.json");
    assert.equal(imported.schemaVersion, "1.0.0");
  });

  it("invalid schema version is rejected", async () => {
    const registry = createRegistry();
    const result = await exportRuntimeCheckpoint(registry, ".alfa-agent/p7.2-good.json");
    const mutated = { ...result.checkpoint, schemaVersion: "999.0.0" };
    await fs.writeFile(goodFile, JSON.stringify(mutated, null, 2), "utf-8");
    await assert.rejects(() => importRuntimeCheckpoint(".alfa-agent/p7.2-good.json"));
  });

  it("malformed JSON is rejected", async () => {
    await fs.writeFile(badFile, "{ malformed ", "utf-8");
    await assert.rejects(() => importRuntimeCheckpoint(".alfa-agent/p7.2-bad.json"));
  });

  it("secret/path/raw-command leakage is rejected on import", async () => {
    const registry = createRegistry();
    const result = await exportRuntimeCheckpoint(registry, ".alfa-agent/p7.2-good.json");
    const mutated = JSON.parse(JSON.stringify(result.checkpoint)) as Record<string, unknown>;
    const data = mutated.data as Record<string, unknown>;
    data.configSummary = { apiKey: "test-api-key-placeholder" };
    mutated.checksum = "broken";
    await fs.writeFile(goodFile, JSON.stringify(mutated, null, 2), "utf-8");
    await assert.rejects(() => importRuntimeCheckpoint(".alfa-agent/p7.2-good.json"));
  });

  it("import does not execute tools or commands", async () => {
    const registry = createRegistry();
    await exportRuntimeCheckpoint(registry, ".alfa-agent/p7.2-good.json");
    const before = globalObservability.getSnapshot().totalExecutions;
    await importRuntimeCheckpoint(".alfa-agent/p7.2-good.json");
    const after = globalObservability.getSnapshot().totalExecutions;
    assert.equal(after, before);
  });

  it("CLI export/import command behavior returns zero", async () => {
    const exportCode = await runCheckpointExport(".alfa-agent/p7.2-good.json");
    assert.equal(exportCode, 0);
    const importCode = await runCheckpointImport(".alfa-agent/p7.2-good.json");
    assert.equal(importCode, 0);
  });
});
