#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { initSystem } from "./core/initSystem.js";
import { buildProviderConfig, loadRuntimeConfig } from "./core/runtimeConfig.js";
import { redactProviderConfig } from "./llm/providerUtils.js";
import { buildRuntimeSnapshot } from "./core/runtimeSnapshot.js";
import { exportRuntimeCheckpoint, importRuntimeCheckpoint, applyRuntimeCheckpoint } from "./core/runtimeCheckpoint.js";
import { exportAuditLog, verifyAuditLog, readAuditLog, globalAuditTrail, simulateReplay } from "./core/auditTrail.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function runLocalNodeScript(scriptRelativePath: string): number {
  const scriptPath = path.resolve(packageRoot, scriptRelativePath);
  if (!fs.existsSync(scriptPath)) {
    console.error(`Script not found: ${scriptRelativePath}`);
    return 1;
  }

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: packageRoot,
    stdio: "inherit",
  });

  return result.status ?? 1;
}

function runNpmScript(scriptName: string): number {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCmd, ["run", scriptName], {
    cwd: packageRoot,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

function redactRuntimeConfig(config: ReturnType<typeof loadRuntimeConfig>): Record<string, unknown> {
  return {
    provider: redactProviderConfig(buildProviderConfig()),
    workspaceRoot: config.workspaceRoot,
    debugMode: config.debugMode,
    timeouts: config.timeouts,
    policy: config.policy,
    observability: config.observability,
  };
}

export async function runHealth(): Promise<number> {
  const { registry } = initSystem();
  printJson(registry.getHealthSnapshot());
  return 0;
}

export async function runToolsList(): Promise<number> {
  const { registry } = initSystem();
  const defs = registry.listDefinitions().map((d) => ({
    name: d.name,
    description: d.description,
    hasSchema: Boolean(d.schema),
    policy: d.policy
      ? {
        tier: d.policy.tier,
        requiresApproval: d.policy.requiresApproval,
      }
      : null,
  }));
  printJson({ total: defs.length, tools: defs });
  return 0;
}

export async function runConfigCheck(): Promise<number> {
  const cfg = loadRuntimeConfig();
  printJson({ ok: true, config: redactRuntimeConfig(cfg) });
  return 0;
}

export async function runRuntimeSnapshot(): Promise<number> {
  const { registry } = initSystem();
  printJson(buildRuntimeSnapshot(registry));
  return 0;
}

export async function runCheckpointExport(filePath?: string): Promise<number> {
  const { registry } = initSystem();
  const out = await exportRuntimeCheckpoint(registry, filePath);
  printJson({
    ok: true,
    path: out.path,
    schemaVersion: out.checkpoint.schemaVersion,
    createdAt: out.checkpoint.createdAt,
    runtimeVersion: out.checkpoint.runtimeVersion,
    checksum: out.checkpoint.checksum,
  });
  return 0;
}

export async function runCheckpointImport(filePath?: string): Promise<number> {
  const { registry } = initSystem();
  const checkpoint = await importRuntimeCheckpoint(filePath);
  applyRuntimeCheckpoint(registry, checkpoint);
  printJson({
    ok: true,
    schemaVersion: checkpoint.schemaVersion,
    createdAt: checkpoint.createdAt,
    runtimeVersion: checkpoint.runtimeVersion,
    checksum: checkpoint.checksum,
    summary: {
      approvals: checkpoint.data.approvals.length,
      cacheEntries: checkpoint.data.cache.entries,
      quotaViolations: checkpoint.data.quota.violations,
    },
  });
  return 0;
}

export async function runAuditExport(filePath?: string): Promise<number> {
  const out = await exportAuditLog(filePath);
  printJson({ ok: true, path: out.path, eventCount: out.log.eventCount, chainTip: out.log.chainTip, checksum: out.log.checksum });
  return 0;
}

export async function runAuditVerify(filePath?: string): Promise<number> {
  const out = await verifyAuditLog(filePath);
  printJson(out);
  return out.valid ? 0 : 1;
}

export async function runReplaySimulate(filePath?: string): Promise<number> {
  const events = filePath ? (await readAuditLog(filePath)).events : globalAuditTrail.snapshot();
  printJson(simulateReplay(events));
  return 0;
}

function printHelp(): void {
  process.stdout.write(
    [
      "alfa-agent-mcp commands:",
      "  health         Show runtime health snapshot",
      "  release-check  Run release gates (lint, typecheck, test, build, env:guard)",
      "  tools:list     List registered tool metadata (no handlers)",
      "  config:check   Validate and print redacted runtime config",
      "  runtime:snapshot  Print redacted runtime state snapshot",
      "  snapshot      Alias of runtime:snapshot",
      "  checkpoint:export [path]  Export safe runtime checkpoint JSON",
      "  checkpoint:import [path]  Import and validate checkpoint JSON",
      "  audit:export [path]       Export signed runtime audit log",
      "  audit:verify [path]       Verify audit hash-chain and checksum",
      "  replay:simulate [path]    Deterministic replay simulation from audit log",
      "  env:guard      Run environment-read guard",
      "  serve          Start MCP stdio server",
      "",
      "When no command is provided, 'serve' is used.",
    ].join("\n") + "\n"
  );
}

export async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "serve";

  switch (cmd) {
    case "health":
      process.exit(await runHealth());
      return;
    case "release-check":
      process.exit(runNpmScript("release:check"));
      return;
    case "tools:list":
      process.exit(await runToolsList());
      return;
    case "config:check":
      process.exit(await runConfigCheck());
      return;
    case "runtime:snapshot":
    case "snapshot":
      process.exit(await runRuntimeSnapshot());
      return;
    case "checkpoint:export":
      process.exit(await runCheckpointExport(process.argv[3]));
      return;
    case "checkpoint:import":
      process.exit(await runCheckpointImport(process.argv[3]));
      return;
    case "audit:export":
      process.exit(await runAuditExport(process.argv[3]));
      return;
    case "audit:verify":
      process.exit(await runAuditVerify(process.argv[3]));
      return;
    case "replay:simulate":
      process.exit(await runReplaySimulate(process.argv[3]));
      return;
    case "env:guard":
      process.exit(runLocalNodeScript("scripts/check-env-reads.mjs"));
      return;
    case "serve": {
      await import("./index.js");
      return;
    }
    case "help":
    case "--help":
    case "-h":
      printHelp();
      process.exit(0);
      return;
    default:
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

const isDirectExecution = (() => {
  const argvPath = process.argv[1];
  if (!argvPath) return false;
  return pathToFileURL(path.resolve(argvPath)).href === import.meta.url;
})();

if (isDirectExecution) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
