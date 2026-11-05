import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { globalObservability } from "../src/core/observability.js";
import { globalBudgetEngine } from "../src/core/budgetEngine.js";
import { LLMClient } from "../src/llm/llmClient.js";
import { createRootTraceContext } from "../src/core/traceContext.js";
import { ToolExecutionErrorClass, ErrorCode } from "../src/core/errorResponse.js";
import { ToolRegistry } from "../src/core/toolRegistry.js";
import { PolicyEngine, PolicyTier } from "../src/core/policyEngine.js";
import { ApprovalEngine } from "../src/core/approvalEngine.js";
import { executePlan } from "../src/engine/executePlan.js";
import { planSessionToolHandler } from "../src/tools/planSession.js";
import { metricsSnapshotToolHandler } from "../src/tools/metricsSnapshot.js";

const realFetch = globalThis.fetch;

function makeRegistryWithPolicy(policyEntries: Array<[string, { tier: PolicyTier; defaultAllow?: boolean; requiresApproval?: boolean }]>): ToolRegistry {
  const pe = new PolicyEngine(new Map(policyEntries));
  const ae = new ApprovalEngine();
  return new ToolRegistry(pe, ae);
}

describe("P6.1 Advanced Observability & Metrics", () => {
  beforeEach(() => {
    globalObservability.reset();
    globalBudgetEngine.reset("plan-a");
    globalBudgetEngine.reset("budget-tools");
    globalThis.fetch = realFetch;
  });

  it("accumulates token/cost estimates including per-plan cost", async () => {
    process.env.LLM_API_KEY = "test-api-key-placeholder";
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "hello world from provider" } }] }), { status: 200 })) as typeof fetch;

    const client = new LLMClient({ provider: "openai", model: "gpt-4o-mini" });
    await client.generate({ prompt: "count tokens for this prompt please" }, createRootTraceContext({ requestId: "plan-a", toolName: "llm_tool" }));

    const cost = globalObservability.getCost();
    assert.equal(cost.providerRequests, 1);
    assert.ok(cost.estimatedTotalTokens > 0);
    assert.ok(cost.estimatedCostUsd > 0);
    assert.ok(cost.perPlan["plan-a"]);
    assert.equal(cost.perPlan["plan-a"].providerRequests, 1);
  });

  it("enforces token and cost budgets with normalized violations", () => {
    globalBudgetEngine.applyBudget({ maxTokensPerExecution: 5, maxCostUsdPerExecution: 0.000001 }, "plan-a");

    assert.throws(
      () => globalBudgetEngine.checkTokens("plan-a", undefined, 8),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PLAN_LIMIT_EXCEEDED
    );
    assert.throws(
      () => globalBudgetEngine.checkCost("plan-a", undefined, 0.01),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PLAN_LIMIT_EXCEEDED
    );

    const snap = globalObservability.getSnapshot();
    assert.ok(snap.budgetViolations.some(v => v.type === "maxTokens"));
    assert.ok(snap.budgetViolations.some(v => v.type === "maxCost"));
  });

  it("enforces max tool calls per execution scope", async () => {
    const reg = makeRegistryWithPolicy([["noop", { tier: PolicyTier.SAFE_WRITE, defaultAllow: true }]]);
    reg.register("noop", async () => ({ ok: true }));
    globalBudgetEngine.applyBudget({ maxToolCallsPerExecution: 1 }, "budget-tools");

    await reg.execute("noop", {}, "budget-tools");
    await assert.rejects(
      () => reg.execute("noop", {}, "budget-tools"),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PLAN_LIMIT_EXCEEDED
    );
  });

  it("captures timeline ordering and latency percentiles", async () => {
    const reg = makeRegistryWithPolicy([["ok", { tier: PolicyTier.SAFE_WRITE, defaultAllow: true }]]);
    reg.register("ok", async () => ({ ok: true }));

    await executePlan(reg, { steps: [{ tool: "ok", input: {} }, { tool: "ok", input: {} }] }, undefined, "plan-order");
    const snap = globalObservability.getSnapshot();
    const timeline = snap.timelines[snap.timelines.length - 1];

    assert.equal(timeline.planId, "plan-order");
    assert.ok((timeline.endTime ?? 0) >= timeline.startTime);
    assert.ok(timeline.spans.every(s => (s.endTime ?? s.startTime) >= s.startTime));
    assert.ok(snap.planLatencyPercentiles.p50Ms >= 0);
    assert.ok(snap.planLatencyPercentiles.p95Ms >= 0);
    assert.ok(snap.planLatencyPercentiles.p99Ms >= 0);
  });

  it("captures rollback span when transaction rollback runs inside timeline", async () => {
    globalObservability.startTimeline("plan-rollback", "rollback-test");
    const start = await planSessionToolHandler({ action: "start", name: "rb" });
    const sessionId = JSON.parse(start.content[0].text).sessionId as string;
    await planSessionToolHandler({ action: "rollback", sessionId });
    globalObservability.endTimeline("rolled_back");

    const snap = globalObservability.getSnapshot();
    const timeline = snap.timelines[snap.timelines.length - 1];
    assert.ok(timeline.spans.some(s => s.type === "rollback"));
  });

  it("metrics snapshot shape is stable and includes required fields", async () => {
    const out = await metricsSnapshotToolHandler({ includeTimelines: true, topN: 5 });
    const parsed = JSON.parse(out.content[0].text) as Record<string, unknown>;

    const required = [
      "runtimeStatus", "totalExecutions", "executionCounts", "successRate", "failureRate",
      "cost", "budgetViolations", "latency", "topSlowTools", "errors", "activeTraces", "safeForDisplay",
    ];
    for (const k of required) assert.ok(k in parsed);
  });

  it("snapshot and logs do not leak secrets or absolute paths", () => {
    globalObservability.startTimeline("plan-secret", "apiKey=sk-123 C:\\Users\\Secret\\config");
    globalObservability.recordTimelineSpan({
      type: "checkpoint",
      name: "token=abc123 /home/user/secret.env",
      startTime: Date.now(),
      endTime: Date.now() + 1,
      success: true,
    });
    globalObservability.endTimeline("completed");

    const dump = JSON.stringify(globalObservability.getSnapshot());
    assert.equal(dump.includes("sk-123"), false);
    assert.equal(dump.includes("C:\\Users\\Secret"), false);
    assert.equal(dump.includes("/home/user/secret.env"), false);
  });
});

