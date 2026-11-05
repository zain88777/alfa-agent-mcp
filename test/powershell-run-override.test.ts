import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function createWorkspace(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function importPowershellRun() {
  return import(`../src/tools/powershellRun.js?bust=${Date.now()}_${Math.random()}`);
}

describe("powershell_run env override", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("blocked by default for non-allowlisted PowerShell commands", async () => {
    if (process.platform !== "win32") return;

    const workspace = createWorkspace("ps-run-default-");
    process.env.ALFA_WORKSPACE_ROOT = workspace;
    delete process.env.MCP_ALLOW_DANGEROUS_TOOLS;

    const mod = await importPowershellRun();
    await assert.rejects(
      () => mod.powershellRunToolHandler({ command: "Write-Output hello" }),
      /PowerShell command not allowed/i
    );
  });

  it("allowed when MCP_ALLOW_DANGEROUS_TOOLS=true and audit is recorded", async () => {
    if (process.platform !== "win32") return;

    const workspace = createWorkspace("ps-run-allow-");
    process.env.ALFA_WORKSPACE_ROOT = workspace;
    process.env.MCP_ALLOW_DANGEROUS_TOOLS = "true";

    const mod = await importPowershellRun();
    const out = await mod.powershellRunToolHandler({ command: "Write-Output hello" });
    const payload = JSON.parse(out.content[0].text) as { ok: boolean; command: string };
    assert.equal(payload.command, "Write-Output hello");

    const historyPath = path.join(workspace, ".alfa-agent", "powershell-history.json");
    assert.equal(fs.existsSync(historyPath), true);
    const history = JSON.parse(fs.readFileSync(historyPath, "utf8")) as Array<{ command: string }>;
    assert.equal(history.length > 0, true);
    assert.equal(history[history.length - 1]?.command, "Write-Output hello");
  });

  it("timeout guard still enforced when override is enabled", async () => {
    if (process.platform !== "win32") return;

    const workspace = createWorkspace("ps-run-timeout-");
    process.env.ALFA_WORKSPACE_ROOT = workspace;
    process.env.MCP_ALLOW_DANGEROUS_TOOLS = "true";

    const mod = await importPowershellRun();
    const out = await mod.powershellRunToolHandler({
      command: "Start-Sleep -Seconds 2; Write-Output done",
      timeoutMs: 200,
    });
    const payload = JSON.parse(out.content[0].text) as { ok: boolean; message?: string };
    assert.equal(payload.ok, false);
    assert.ok(String(payload.message ?? "").length > 0);
  });
});
