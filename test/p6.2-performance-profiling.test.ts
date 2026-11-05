import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { globalObservability } from "../src/core/observability.js";
import { createRootTraceContext } from "../src/core/traceContext.js";
import { metricsSnapshotToolHandler } from "../src/tools/metricsSnapshot.js";
import { runCommandToolHandler } from "../src/tools/runCommand.js";
import { normalizeSafePath } from "../src/core/pathSafety.js";
import { enforceProtectedPath } from "../src/core/protectedPaths.js";
import { ToolExecutionErrorClass, ErrorCode } from "../src/core/errorResponse.js";
import { ToolRegistry } from "../src/core/toolRegistry.js";
import { PolicyEngine, PolicyTier } from "../src/core/policyEngine.js";
import { ApprovalEngine } from "../src/core/approvalEngine.js";
import { executePlan } from "../src/engine/executePlan.js";

function makeRegistryWithPolicy(policyEntries: Array<[string, { tier: PolicyTier; defaultAllow?: boolean; requiresApproval?: boolean }]>): ToolRegistry {
  const pe = new PolicyEngine(new Map(policyEntries));
  const ae = new ApprovalEngine();
  return new ToolRegistry(pe, ae);
}

describe("P6.2 Performance Profiling (measurement only)", () => {
  beforeEach(() => {
    globalObservability.reset();
  });

  it("profiling snapshot shape is stable via metrics_snapshot", async () => {
    const out = await metricsSnapshotToolHandler({ includeProfiling: true });
    const parsed = JSON.parse(out.content[0].text) as Record<string, unknown>;
    assert.ok("profiling" in parsed);
    const p = parsed.profiling as Record<string, unknown>;
    const keys = [
      "slowestTools",
      "slowestProviderCalls",
      "slowestPlanSteps",
      "commandLatency",
      "fileOperationLatency",
      "pathSafetyLatency",
      "protectedPathLatency",
      "highErrorTools",
      "highDenialTools",
      "warnings",
    ];
    for (const k of keys) assert.ok(k in p);
  });

  it("ranks slow tools and slow providers", () => {
    const trace = createRootTraceContext({ requestId: "rank-1", toolName: "rank" });
    globalObservability.recordToolExecution({ toolName: "fast_tool", trace, success: true, durationMs: 10 });
    globalObservability.recordToolExecution({ toolName: "slow_tool", trace, success: true, durationMs: 2200 });

    globalObservability.recordProviderCall({ provider: "openai", model: "gpt-4o-mini", trace, success: true, durationMs: 50, inputTokens: 10, outputTokens: 10, requestId: "rank-1" });
    globalObservability.recordProviderCall({ provider: "anthropic", model: "claude-3-5-sonnet", trace, success: true, durationMs: 4100, inputTokens: 10, outputTokens: 10, requestId: "rank-1" });

    const p = globalObservability.getSnapshot().profiling;
    assert.equal(p.slowestTools[0]?.toolName, "slow_tool");
    assert.equal(p.slowestProviderCalls[0]?.provider, "anthropic");
  });

  it("captures command latency through run_command instrumentation", async () => {
    await runCommandToolHandler({ commandId: "git_status" });
    const p = globalObservability.getSnapshot().profiling;
    assert.ok(p.commandLatency.calls >= 1);
    assert.ok(p.commandLatency.p50Ms >= 0);
  });

  it("captures path safety and protected-path latency", () => {
    normalizeSafePath("package.json");

    assert.throws(
      () => enforceProtectedPath("C:\\repo\\.env", "write_file"),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PATH_DENIED
    );

    const p = globalObservability.getSnapshot().profiling;
    assert.ok(p.pathSafetyLatency.calls >= 1);
    assert.ok(p.protectedPathLatency.calls >= 1);
  });

  it("keeps latency sample windows bounded", () => {
    const trace = createRootTraceContext({ requestId: "bounded-1", toolName: "bounded_tool" });
    for (let i = 0; i < 1200; i++) {
      globalObservability.recordToolExecution({ toolName: "bounded_tool", trace, success: true, durationMs: (i % 7) + 1 });
      globalObservability.recordCommandExecution((i % 11) + 1, true);
    }
    const snap = globalObservability.getSnapshot();
    const tool = snap.toolLatencyPercentiles.find(t => t.toolName === "bounded_tool");
    assert.ok((tool?.count ?? 0) <= 1000);
    assert.ok(snap.profiling.commandLatency.count <= 1000);
  });

  it("generates non-blocking performance warnings", async () => {
    const reg = makeRegistryWithPolicy([["ok", { tier: PolicyTier.SAFE_WRITE, defaultAllow: true }]]);
    reg.register("ok", async () => ({ ok: true }));
    const steps = Array.from({ length: 45 }, () => ({ tool: "ok", input: {} }));
    const out = await executePlan(reg, { steps }, undefined, "warn-plan-1");
    assert.equal(out.length, 45);

    const warnings = globalObservability.getSnapshot().profiling.warnings;
    assert.ok(warnings.some(w => w.type === "excessive_tool_calls"));
  });

  it("profiling output does not leak secrets or absolute paths", async () => {
    globalObservability.startTimeline("secret-plan", "apiKey=sk-leak-test C:\\Users\\Secret\\x");
    globalObservability.recordTimelineSpan({
      type: "step",
      name: "token=abc123 /home/user/private.env",
      startTime: Date.now(),
      endTime: Date.now() + 1,
      success: true,
    });
    globalObservability.endTimeline("completed");

    const out = await metricsSnapshotToolHandler({ includeProfiling: true, includeTimelines: true });
    const dump = out.content[0].text;
    assert.equal(dump.includes("sk-leak-test"), false);
    assert.equal(dump.includes("C:\\Users\\Secret"), false);
    assert.equal(dump.includes("/home/user/private.env"), false);
  });
});

