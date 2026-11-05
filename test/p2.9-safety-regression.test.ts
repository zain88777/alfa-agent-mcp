import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { normalizeSafePath } from "../src/core/pathSafety.js";
import { runCommandToolHandler } from "../src/tools/runCommand.js";
import { ToolExecutionErrorClass, ErrorCode } from "../src/core/errorResponse.js";
import { ToolRegistry } from "../src/core/toolRegistry.js";
import { PolicyEngine, PolicyTier } from "../src/core/policyEngine.js";
import { ApprovalEngine } from "../src/core/approvalEngine.js";
import { executePlan } from "../src/engine/executePlan.js";
import { withTimeout } from "../src/core/timeout.js";
import { LogLevel } from "../src/core/toolLogger.js";

function createWorkspace(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("P2.9 Path safety regression", () => {
  it("blocks traversal outside workspace", () => {
    const base = createWorkspace("p29-path-");
    assert.throws(() => normalizeSafePath("..\\outside.txt", { allowedBase: base }), /outside allowed workspace/i);
  });

  it("blocks sibling-prefix bypass", () => {
    const root = createWorkspace("p29-base-");
    const sibling = `${root}-sibling`;
    fs.mkdirSync(sibling, { recursive: true });
    assert.throws(() => normalizeSafePath(sibling, { allowedBase: root }), /outside allowed workspace/i);
  });

  it("blocks Windows drive mismatch", () => {
    if (process.platform !== "win32") return;
    const base = "C:\\workspace";
    assert.throws(() => normalizeSafePath("D:\\other\\file.txt", { allowedBase: base }), /different drive/i);
  });

  it("blocks UNC path", () => {
    if (process.platform !== "win32") return;
    assert.throws(() => normalizeSafePath("\\\\server\\share\\file.txt", { allowedBase: "C:\\workspace" }), /UNC\/network/i);
  });

  it("blocks system directory", () => {
    const base = process.platform === "win32" ? "C:\\" : "/";
    const sysPath = process.platform === "win32" ? "C:\\Windows\\System32\\drivers\\etc\\hosts" : "/etc/passwd";
    assert.throws(() => normalizeSafePath(sysPath, { allowedBase: base }), /not allowed|outside allowed workspace/i);
  });

  it("blocks symlink escape where supported", () => {
    const base = createWorkspace("p29-symlink-base-");
    const outsideDir = createWorkspace("p29-symlink-out-");
    const outsideTarget = path.join(outsideDir, "secret.txt");
    fs.writeFileSync(outsideTarget, "secret", "utf8");
    const linkPath = path.join(base, "link.txt");

    try {
      fs.symlinkSync(outsideTarget, linkPath);
    } catch {
      return;
    }

    assert.throws(() => normalizeSafePath(linkPath, { allowedBase: base, rejectSymlinkEscapes: true }), /symlink points outside/i);
  });

  it("does not leak raw user path in normalized error envelope", () => {
    const base = createWorkspace("p29-path-leak-");
    const attackerPath = "C:\\Users\\VerySecret\\token.txt";
    let rawErr: unknown;
    try {
      normalizeSafePath(attackerPath, { allowedBase: base });
    } catch (e) {
      rawErr = e;
    }

    const normalized = ToolExecutionErrorClass.from(rawErr, { defaultTool: "read_file" }).toJSON();
    assert.equal(normalized.code, ErrorCode.INTERNAL_ERROR);
    assert.ok(!normalized.message.includes("VerySecret"));
    assert.ok(!normalized.message.includes("token.txt"));
  });
});

describe("P2.9 Command hardening regression", () => {
  const oldPath = process.env.PATH;
  const oldPathWin = (process.env as Record<string, string | undefined>).Path;
  const oldPathext = process.env.PATHEXT;
  const fakeBin = createWorkspace("p29-fakebin-");
  const npmCmd = path.join(fakeBin, "npm.cmd");
  const npmSh = path.join(fakeBin, "npm");
  let fakeNpmAvailable = false;

  beforeEach(() => {
    const script = [
      "@echo off",
      "setlocal EnableDelayedExpansion",
      "if \"%1\"==\"test\" (",
      "  if \"%P29_FAIL_TEST%\"==\"1\" exit /b 2",
      "  echo LEGACY_OK",
      "  exit /b 0",
      ")",
      "if \"%1\"==\"run\" if \"%2\"==\"test\" (",
      "  echo CMDID_OK",
      "  exit /b 0",
      ")",
      "if \"%1\"==\"run\" if \"%2\"==\"build\" (",
      "  set i=0",
      "  :loop",
      "  set /a i=!i!+1",
      "  echo 12345678901234567890123456789012345678901234567890",
      "  if !i! LSS 30000 goto loop",
      "  exit /b 0",
      ")",
      "if \"%1\"==\"run\" if \"%2\"==\"dev\" (",
      "  ping 127.0.0.1 -n 6 >nul",
      "  exit /b 0",
      ")",
      "if \"%1\"==\"run\" if \"%2\"==\"install\" (",
      "  echo CWD:%CD%",
      "  exit /b 0",
      ")",
      "if \"%1\"==\"run\" if \"%2\"==\"build-fail\" (",
      "  echo boom 1>&2",
      "  exit /b 2",
      ")",
      "exit /b 1",
    ].join("\r\n");

    fs.writeFileSync(npmCmd, script, "utf8");
    fs.writeFileSync(
      npmSh,
      "#!/usr/bin/env sh\nif [ \"$1\" = \"test\" ]; then [ \"$P29_FAIL_TEST\" = \"1\" ] && exit 2; echo LEGACY_OK; exit 0; fi\nif [ \"$1\" = \"run\" ] && [ \"$2\" = \"test\" ]; then [ \"$P29_FAIL_TEST\" = \"1\" ] && exit 2; echo CMDID_OK; exit 0; fi\nif [ \"$1\" = \"run\" ] && [ \"$2\" = \"build\" ]; then i=0; while [ $i -lt 30000 ]; do i=$((i+1)); echo 12345678901234567890123456789012345678901234567890; done; exit 0; fi\nif [ \"$1\" = \"run\" ] && [ \"$2\" = \"dev\" ]; then sleep 5; exit 0; fi\nif [ \"$1\" = \"install\" ]; then echo CWD:$PWD; exit 0; fi\nexit 1\n",
      "utf8"
    );
    try { fs.chmodSync(npmSh, 0o755); } catch {}

    if (process.platform === "win32") {
      (process.env as Record<string, string | undefined>).Path = `${fakeBin};${oldPathWin ?? oldPath ?? ""}`;
      process.env.PATH = `${fakeBin};${oldPath ?? oldPathWin ?? ""}`;
      process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
    } else {
      process.env.PATH = `${fakeBin}:${oldPath ?? ""}`;
    }

    const probe = spawnSync("npm", ["test"], { encoding: "utf8" });
    fakeNpmAvailable = !probe.error;
  });

  afterEach(() => {
    process.env.PATH = oldPath;
    (process.env as Record<string, string | undefined>).Path = oldPathWin;
    process.env.PATHEXT = oldPathext;
    delete process.env.P29_FAIL_TEST;
  });

  it("legacy allowed command works", async () => {
    if (!fakeNpmAvailable) return;
    const out = await runCommandToolHandler({ command: "npm test", timeout: 5000 });
    assert.equal(out.content[0].type, "text");
    assert.ok(out.content[0].text.includes("LEGACY_OK"));
  });

  it("unknown legacy command denied", async () => {
    if (!fakeNpmAvailable) return;
    await assert.rejects(
      () => runCommandToolHandler({ command: "rm -rf /", timeout: 5000 }),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.COMMAND_DENIED
    );
  });

  it("unknown commandId denied", async () => {
    if (!fakeNpmAvailable) return;
    await assert.rejects(
      () => runCommandToolHandler({ commandId: "evil_cmd", timeout: 5000 }),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.COMMAND_DENIED
    );
  });

  it("commandId allowlist works", async () => {
    if (!fakeNpmAvailable) return;
    const out = await runCommandToolHandler({ commandId: "npm_test", timeout: 5000 });
    assert.ok(out.content[0].text.includes("CMDID_OK"));
  });

  it("command injection string blocked", async () => {
    if (!fakeNpmAvailable) return;
    await assert.rejects(
      () => runCommandToolHandler({ command: "npm test && whoami", timeout: 5000 }),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.COMMAND_DENIED
    );
  });

  it("timeout kills process", async () => {
    if (!fakeNpmAvailable) return;
    await assert.rejects(
      () => runCommandToolHandler({ command: "npm run dev", timeout: 1000 }),
      (e: unknown) => e instanceof Error && /timed out/i.test(e.message)
    );
  });

  it("stdout/stderr truncation path enforces bounded output", async () => {
    if (!fakeNpmAvailable) return;
    await assert.rejects(
      () => runCommandToolHandler({ command: "npm run build", timeout: 30000 }),
      (e: unknown) => {
        if (!(e instanceof ToolExecutionErrorClass)) return false;
        if (e.code !== ErrorCode.COMMAND_FAILED) return false;
        const stdout = String(e.details?.stdout ?? "");
        return stdout.length <= 1_048_576;
      }
    );
  });

  it("non-zero exit returns COMMAND_FAILED", async () => {
    if (!fakeNpmAvailable) return;
    process.env.P29_FAIL_TEST = "1";
    await assert.rejects(
      () => runCommandToolHandler({ commandId: "npm_test", timeout: 5000 }),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.COMMAND_FAILED
    );
  });

  it("cwd fixed to workspace root", async () => {
    if (!fakeNpmAvailable) return;
    const out = await runCommandToolHandler({ commandId: "npm_install", timeout: 5000 });
    assert.ok(out.content[0].text.includes(`CWD:${process.cwd()}`));
  });
});

describe("P2.9 Registry/policy regression", () => {
  it("denied execution never calls handler", async () => {
    const pe = new PolicyEngine(new Map([
      ["blocked_tool", { tier: PolicyTier.DANGEROUS, defaultAllow: false, requiresApproval: true }],
    ]));
    const reg = new ToolRegistry(pe, new ApprovalEngine({ approvalExpiryMs: 60000 }));
    let called = false;
    reg.register("blocked_tool", async () => {
      called = true;
      return {};
    });
    await assert.rejects(() => reg.execute("blocked_tool", {}, "req-deny"));
    assert.equal(called, false);
  });

  it("unclassified tool fails health check", () => {
    const reg = new ToolRegistry(new PolicyEngine(), new ApprovalEngine());
    reg.register("unclassified_custom_tool", async () => ({ ok: true }));
    const snap = reg.getHealthSnapshot();
    assert.equal(snap.unclassifiedTools >= 1, true);
    assert.equal(snap.status, "unhealthy");
  });

  it("metadata-only definitions expose no handler", () => {
    const reg = new ToolRegistry(new PolicyEngine(), new ApprovalEngine());
    reg.register("meta_only", async () => ({ ok: true }));
    const defs = reg.listDefinitions();
    const d = defs.find(x => x.name === "meta_only");
    assert.ok(d);
    assert.equal("handler" in (d as object), false);
  });

  it("dangerous tool requires approval", async () => {
    const pe = new PolicyEngine(new Map([
      ["danger_tool", { tier: PolicyTier.DANGEROUS, defaultAllow: false, requiresApproval: true }],
    ]));
    const reg = new ToolRegistry(pe, new ApprovalEngine());
    reg.register("danger_tool", async () => ({ ok: true }));
    await assert.rejects(() => reg.execute("danger_tool", {}, "req-danger"), (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.POLICY_DENIED);
  });

  it("nested dangerous does not inherit approval", async () => {
    const pe = new PolicyEngine(new Map([
      ["parent_d", { tier: PolicyTier.DANGEROUS, defaultAllow: false, requiresApproval: true }],
      ["child_d", { tier: PolicyTier.DANGEROUS, defaultAllow: false, requiresApproval: true }],
    ]));
    const ae = new ApprovalEngine();
    const reg = new ToolRegistry(pe, ae);

    reg.register("child_d", async () => ({ ok: true }));
    reg.register("parent_d", async (_i, ctx) => {
      return reg.execute("child_d", {}, ctx?.requestId, ctx?.metadata.depth, ctx?.signal);
    });

    const rec = ae.request("req-parent", "parent_d", PolicyTier.DANGEROUS, {});
    ae.approve(rec.id, "tester");

    await assert.rejects(() => reg.execute("parent_d", {}, "req-parent"), (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.POLICY_DENIED);
  });
});

describe("P2.9 Plan safety regression", () => {
  it("max steps enforced", async () => {
    const reg = new ToolRegistry(new PolicyEngine(), new ApprovalEngine());
    const plan = { steps: Array.from({ length: 3 }, () => ({ tool: "noop", input: {} })) };
    await assert.rejects(
      () => executePlan(reg, plan, { maxSteps: 2, maxDepth: 5, maxConsecutiveFailures: 3, allowRecursive: false }),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PLAN_LIMIT_EXCEEDED
    );
  });

  it("max depth enforced", async () => {
    const reg = new ToolRegistry(new PolicyEngine(), new ApprovalEngine());
    await assert.rejects(
      () => executePlan(reg, { steps: [{ tool: "noop", input: {} }] }, { maxSteps: 5, maxDepth: 0, maxConsecutiveFailures: 3, allowRecursive: false }, "req", 1),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PLAN_LIMIT_EXCEEDED
    );
  });

  it("recursion detection enforced", async () => {
    const reg = new ToolRegistry(new PolicyEngine(), new ApprovalEngine());
    const plan = { steps: [{ tool: "execute_plan" }, { tool: "execute_plan" }] };
    await assert.rejects(
      () => executePlan(reg, plan, { maxSteps: 10, maxDepth: 5, maxConsecutiveFailures: 3, allowRecursive: false }),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PLAN_LIMIT_EXCEEDED
    );
  });

  it("consecutive failure cutoff enforced", async () => {
    const pe = new PolicyEngine(new Map([
      ["always_fail", { tier: PolicyTier.SAFE_WRITE, defaultAllow: true, requiresApproval: false }],
    ]));
    const reg = new ToolRegistry(pe, new ApprovalEngine());
    reg.register("always_fail", async () => {
      throw new Error("nope");
    });
    const plan = { steps: [{ tool: "always_fail" }, { tool: "always_fail" }, { tool: "always_fail" }] };

    await assert.rejects(
      () => executePlan(reg, plan, { maxSteps: 10, maxDepth: 5, maxConsecutiveFailures: 2, allowRecursive: false }),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PLAN_LIMIT_EXCEEDED
    );
  });

  it("parent requestId lineage preserved", async () => {
    const pe = new PolicyEngine(new Map([
      ["capture_lineage", { tier: PolicyTier.SAFE_WRITE, defaultAllow: true, requiresApproval: false }],
    ]));
    const reg = new ToolRegistry(pe, new ApprovalEngine());
    let seenParent: string | undefined;
    reg.register("capture_lineage", async (_i, ctx) => {
      seenParent = ctx?.metadata.parentRequestId;
      return { ok: true };
    });
    await executePlan(reg, { steps: [{ tool: "capture_lineage", input: {} }] }, undefined, "req-parent-lineage", 0);
    assert.equal(seenParent, "req-parent-lineage");
  });
});

describe("P2.9 Cancellation regression", () => {
  it("AbortSignal cancels execution", async () => {
    const pe = new PolicyEngine(new Map([
      ["long_task", { tier: PolicyTier.SAFE_WRITE, defaultAllow: true, requiresApproval: false }],
    ]));
    const reg = new ToolRegistry(pe, new ApprovalEngine());
    reg.register("long_task", async (_i, ctx) => new Promise((_r, rej) => {
      ctx?.signal.addEventListener("abort", () => rej(new Error("aborted")), { once: true });
    }));

    const parent = new AbortController();
    const p = reg.execute("long_task", {}, "req-cancel", 0, parent.signal);
    parent.abort();

    await assert.rejects(p, (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.CANCELLED);
  });

  it("child execution inherits parent cancellation", async () => {
    const pe = new PolicyEngine(new Map([
      ["child_task", { tier: PolicyTier.SAFE_WRITE, defaultAllow: true, requiresApproval: false }],
      ["parent_task", { tier: PolicyTier.SAFE_WRITE, defaultAllow: true, requiresApproval: false }],
    ]));
    const reg = new ToolRegistry(pe, new ApprovalEngine());

    reg.register("child_task", async (_i, ctx) => new Promise((_r, rej) => {
      ctx?.signal.addEventListener("abort", () => rej(new Error("child aborted")), { once: true });
    }));

    reg.register("parent_task", async (_i, ctx) => {
      return reg.execute("child_task", {}, ctx?.requestId, ctx?.metadata.depth, ctx?.signal);
    });

    const parent = new AbortController();
    const p = reg.execute("parent_task", {}, "req-parent-cancel", 0, parent.signal);
    parent.abort();
    await assert.rejects(p, (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.CANCELLED);
  });

  it("cleanup callback is called", async () => {
    const ac = new AbortController();
    let cleaned = false;
    const never = new Promise<void>(() => undefined);
    const wrapped = withTimeout(never, 10000, "cleanup_test", ac.signal, () => {
      cleaned = true;
    });
    ac.abort();
    await assert.rejects(wrapped);
    assert.equal(cleaned, true);
  });
});

describe("P2.9 Audit/observability regression", () => {
  it("denial creates audit record", async () => {
    const pe = new PolicyEngine(new Map([
      ["denied_tool", { tier: PolicyTier.DANGEROUS, defaultAllow: false, requiresApproval: true }],
    ]));
    const reg = new ToolRegistry(pe, new ApprovalEngine());
    reg.register("denied_tool", async () => ({ ok: true }));
    reg.clearLogs();

    await assert.rejects(() => reg.execute("denied_tool", {}, "req-audit-deny"));
    const logs = reg.getLogs();
    assert.ok(logs.some(l => l.toolName === "policy_denial"));
  });

  it("execution start/end records correlate by requestId", async () => {
    const pe = new PolicyEngine(new Map([
      ["ok_tool", { tier: PolicyTier.SAFE_WRITE, defaultAllow: true, requiresApproval: false }],
    ]));
    const reg = new ToolRegistry(pe, new ApprovalEngine());
    reg.register("ok_tool", async () => ({ ok: true }));
    reg.clearLogs();

    await reg.execute("ok_tool", { x: 1 }, "req-audit-ok");
    const logs = reg.getLogs().filter(l => l.toolName === "ok_tool");
    const requestIds = new Set(logs.map(l => l.requestId).filter(Boolean));
    assert.equal(logs.length >= 2, true);
    assert.equal(requestIds.size, 1);
  });

  it("getLogs() returns copy, not mutable reference", () => {
    const reg = new ToolRegistry(new PolicyEngine(), new ApprovalEngine());
    reg.clearLogs();
    const a = reg.getLogs();
    a.push({
      id: "fake",
      timestamp: new Date().toISOString(),
      toolName: "fake",
      logLevel: LogLevel.INFO,
      startTime: Date.now(),
    });
    const b = reg.getLogs();
    assert.equal(b.some(l => l.id === "fake"), false);
  });

  it("health snapshot shape remains stable", () => {
    const reg = new ToolRegistry(new PolicyEngine(), new ApprovalEngine());
    const snap = reg.getHealthSnapshot() as Record<string, unknown>;
    const keys = [
      "status", "totalTools", "healthyTools", "unclassifiedTools", "schematizedTools",
      "totalExecutions", "totalErrors", "timeoutCounts", "cancellationCounts",
      "policyDeniedCounts", "successRate", "latencyBuckets", "issues",
    ];
    for (const k of keys) {
      assert.ok(k in snap);
    }
  });
});
