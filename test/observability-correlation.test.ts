import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "../src/core/toolRegistry.js";
import { ApprovalEngine } from "../src/core/approvalEngine.js";
import { PolicyEngine, PolicyTier } from "../src/core/policyEngine.js";
import { createRootTraceContext } from "../src/core/traceContext.js";
import { globalObservability } from "../src/core/observability.js";
import { LLMClient } from "../src/llm/llmClient.js";
import { ErrorCode, ToolExecutionErrorClass } from "../src/core/errorResponse.js";
import { setToolTimeout } from "../src/core/timeout.js";

const realFetch = globalThis.fetch;

function makeRegistryWithPolicy(policyEntries: Array<[string, { tier: PolicyTier; defaultAllow?: boolean; requiresApproval?: boolean }]>): ToolRegistry {
  const pe = new PolicyEngine(new Map(policyEntries));
  const ae = new ApprovalEngine();
  return new ToolRegistry(pe, ae);
}

describe("P3.11 Observability & Correlation", () => {
  beforeEach(() => {
    globalObservability.reset();
    globalThis.fetch = realFetch;
  });

  it("preserves traceId across tool execution", async () => {
    const reg = makeRegistryWithPolicy([["trace_tool", { tier: PolicyTier.SAFE_WRITE, defaultAllow: true }]]);
    let seenTraceId = "";
    reg.register("trace_tool", async (_i, ctx) => {
      seenTraceId = ctx?.trace.traceId ?? "";
      return { ok: true };
    });

    const rootTrace = createRootTraceContext({ requestId: "req-trace-1", toolName: "root" });
    await reg.execute("trace_tool", {}, "req-trace-1", 0, undefined, rootTrace);

    assert.equal(seenTraceId, rootTrace.traceId);
  });

  it("links child span to parent span", async () => {
    const reg = makeRegistryWithPolicy([
      ["parent_tool", { tier: PolicyTier.SAFE_WRITE, defaultAllow: true }],
      ["child_tool", { tier: PolicyTier.SAFE_WRITE, defaultAllow: true }],
    ]);

    let parentSpan = "";
    let childParentSpan = "";
    let parentTraceId = "";
    let childTraceId = "";

    reg.register("child_tool", async (_i, ctx) => {
      childParentSpan = ctx?.trace.parentSpanId ?? "";
      childTraceId = ctx?.trace.traceId ?? "";
      return { ok: true };
    });

    reg.register("parent_tool", async (_i, ctx) => {
      parentSpan = ctx?.trace.spanId ?? "";
      parentTraceId = ctx?.trace.traceId ?? "";
      return reg.execute("child_tool", {}, ctx?.requestId, ctx?.metadata.depth, ctx?.signal, ctx?.trace);
    });

    await reg.execute("parent_tool", {}, "req-span-link");

    assert.equal(childParentSpan, parentSpan);
    assert.equal(childTraceId, parentTraceId);
  });

  it("provider call receives trace context", async () => {
    process.env.LLM_API_KEY = "test-api-key-placeholder";
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 })) as typeof fetch;

    const client = new LLMClient({ provider: "openai", model: "gpt-4o-mini" });
    const rootTrace = createRootTraceContext({ requestId: "req-provider-trace", toolName: "tool_x" });
    await client.generate({ prompt: "hello" }, rootTrace);

    const snap = globalObservability.getSnapshot();
    const trace = snap.recentTraces.find(t => t.provider === "openai");
    assert.ok(trace);
    assert.equal(trace?.traceId, rootTrace.traceId);
    assert.equal(trace?.parentSpanId, rootTrace.spanId);
    assert.equal(snap.providerMetrics.openai.calls, 1);
    assert.equal((snap.providerMetrics.openai.modelUsage["gpt-4o-mini"] ?? 0) >= 1, true);
  });

  it("logs redact secrets", async () => {
    const reg = makeRegistryWithPolicy([["leaky_tool", { tier: PolicyTier.SAFE_WRITE, defaultAllow: true }]]);
    reg.register("leaky_tool", async () => {
      throw new Error("apiKey=sk-123 C:\\Users\\Secret\\file.txt");
    });

    await assert.rejects(() => reg.execute("leaky_tool", {}, "req-redact"));
    const logs = reg.getLogs().filter(l => l.toolName === "leaky_tool" && l.logLevel === "ERROR");
    assert.ok(logs.length > 0);
    const last = logs[logs.length - 1];
    assert.ok(!String(last.errorMessage ?? "").includes("sk-123"));
    assert.ok(!String(last.errorMessage ?? "").includes("C:\\Users\\Secret"));
  });

  it("increments metrics on success/failure", async () => {
    const reg = makeRegistryWithPolicy([
      ["ok_tool", { tier: PolicyTier.SAFE_WRITE, defaultAllow: true }],
      ["fail_tool", { tier: PolicyTier.SAFE_WRITE, defaultAllow: true }],
    ]);

    reg.register("ok_tool", async () => ({ ok: true }));
    reg.register("fail_tool", async () => { throw new Error("boom"); });

    await reg.execute("ok_tool", {}, "req-ok");
    await assert.rejects(() => reg.execute("fail_tool", {}, "req-fail"));

    const snap = reg.getObservabilitySnapshot();
    assert.equal(snap.toolMetrics.ok_tool.calls, 1);
    assert.equal(snap.toolMetrics.ok_tool.success, 1);
    assert.equal(snap.toolMetrics.fail_tool.failure, 1);
  });

  it("policy denial increments counter", async () => {
    const reg = makeRegistryWithPolicy([["danger_tool", { tier: PolicyTier.DANGEROUS, requiresApproval: true }]]);
    reg.register("danger_tool", async () => ({ ok: true }));

    await assert.rejects(() => reg.execute("danger_tool", {}, "req-deny"), (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.POLICY_DENIED);
    const snap = reg.getObservabilitySnapshot();
    assert.ok((snap.errorCountsByCode.POLICY_DENIED ?? 0) >= 1);
    assert.ok(snap.policyDenials >= 1);
  });

  it("timeout and cancellation are counted correctly", async () => {
    const reg = makeRegistryWithPolicy([
      ["slow_tool", { tier: PolicyTier.SAFE_WRITE, defaultAllow: true }],
      ["cancel_tool", { tier: PolicyTier.SAFE_WRITE, defaultAllow: true }],
    ]);

    reg.register("slow_tool", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { done: true };
    });

    reg.register("cancel_tool", async (_i, ctx) => {
      return new Promise((_resolve, reject) => {
        ctx?.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });

    setToolTimeout("slow_tool", 10);
    await assert.rejects(() => reg.execute("slow_tool", {}, "req-timeout"), (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.EXECUTION_TIMEOUT);

    const controller = new AbortController();
    const p = reg.execute("cancel_tool", {}, "req-cancel", 0, controller.signal);
    controller.abort();
    await assert.rejects(p, (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.CANCELLED);

    const stats = reg.getStats();
    assert.ok(stats.timeoutCounts >= 1);
    assert.ok(stats.cancellationCounts >= 1);

    const snap = reg.getObservabilitySnapshot();
    assert.ok((snap.errorCountsByCode.EXECUTION_TIMEOUT ?? 0) >= 1);
    assert.ok((snap.errorCountsByCode.CANCELLED ?? 0) >= 1);

    setToolTimeout("slow_tool", 30000);
  });

  it("health snapshot has stable observability shape", () => {
    const reg = makeRegistryWithPolicy([]);
    const h = reg.getHealthSnapshot() as Record<string, unknown>;
    const keys = [
      "status", "totalTools", "healthyTools", "unclassifiedTools", "schematizedTools",
      "totalExecutions", "totalErrors", "timeoutCounts", "cancellationCounts", "policyDeniedCounts",
      "successRate", "latencyBuckets", "issues", "errorCountsByCode", "providerFailures", "recentTraceSummaries",
    ];
    for (const k of keys) {
      assert.ok(k in h);
    }
  });
});
