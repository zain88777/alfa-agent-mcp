import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { globalBudgetEngine } from "../src/core/budgetEngine.js";
import { ToolExecutionErrorClass, ErrorCode } from "../src/core/errorResponse.js";
import { globalObservability } from "../src/core/observability.js";
import { ToolRegistry } from "../src/core/toolRegistry.js";
import { PolicyEngine, PolicyTier } from "../src/core/policyEngine.js";
import { ApprovalEngine } from "../src/core/approvalEngine.js";
import { createRootTraceContext } from "../src/core/traceContext.js";
import { LLMClient } from "../src/llm/llmClient.js";
import { metricsSnapshotToolHandler } from "../src/tools/metricsSnapshot.js";
import { CacheEngine } from "../src/core/cacheEngine.js";

const realFetch = globalThis.fetch;

function makeRegistryWithPolicy(policyEntries: Array<[string, { tier: PolicyTier; defaultAllow?: boolean; requiresApproval?: boolean }]>): ToolRegistry {
  return new ToolRegistry(new PolicyEngine(new Map(policyEntries)), new ApprovalEngine());
}

describe("P6.4 Resource Usage Limits & Quotas", () => {
  beforeEach(() => {
    globalObservability.reset();
    globalBudgetEngine.reset("q-tool");
    globalBudgetEngine.reset("q-provider");
    globalBudgetEngine.reset("q-token");
    globalBudgetEngine.reset("q-cost");
    globalBudgetEngine.reset("q-cmd");
    globalBudgetEngine.reset("q-mut");
    globalBudgetEngine.reset("q-cache");
    globalThis.fetch = realFetch;
  });

  it("tool-call quota exceeded", async () => {
    const reg = makeRegistryWithPolicy([["noop", { tier: PolicyTier.SAFE_WRITE, defaultAllow: true }]]);
    reg.register("noop", async () => ({ ok: true }));
    globalBudgetEngine.applyBudget({ maxToolCallsPerExecution: 1 }, "q-tool");
    await reg.execute("noop", {}, "q-tool");
    await assert.rejects(
      () => reg.execute("noop", {}, "q-tool"),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PLAN_LIMIT_EXCEEDED
    );
  });

  it("provider-call quota exceeded", () => {
    globalBudgetEngine.applyBudget({ maxProviderCallsPerExecution: 1 }, "q-provider");
    globalBudgetEngine.countProviderCall("q-provider", undefined, "openai");
    assert.throws(
      () => globalBudgetEngine.countProviderCall("q-provider", undefined, "openai"),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PLAN_LIMIT_EXCEEDED
    );
  });

  it("token quota exceeded", () => {
    globalBudgetEngine.applyBudget({ maxTokensPerExecution: 10 }, "q-token");
    assert.throws(
      () => globalBudgetEngine.checkTokens("q-token", undefined, 11),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PLAN_LIMIT_EXCEEDED
    );
  });

  it("cost quota exceeded", () => {
    globalBudgetEngine.applyBudget({ maxCostUsdPerExecution: 0.0001 }, "q-cost");
    assert.throws(
      () => globalBudgetEngine.checkCost("q-cost", undefined, 0.01),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PLAN_LIMIT_EXCEEDED
    );
  });

  it("command execution quota exceeded", () => {
    globalBudgetEngine.applyBudget({ maxCommandExecutionsPerExecution: 1 }, "q-cmd");
    globalBudgetEngine.countCommandExecution("q-cmd", undefined);
    assert.throws(
      () => globalBudgetEngine.countCommandExecution("q-cmd", undefined),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PLAN_LIMIT_EXCEEDED
    );
  });

  it("mutation operation quota exceeded", () => {
    globalBudgetEngine.applyBudget({ maxMutationOperationsPerExecution: 1 }, "q-mut");
    globalBudgetEngine.countMutationOperation("q-mut", undefined, "write_file");
    assert.throws(
      () => globalBudgetEngine.countMutationOperation("q-mut", undefined, "apply_patch"),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PLAN_LIMIT_EXCEEDED
    );
  });

  it("cache bound respected and check enforceable", () => {
    const cache = new CacheEngine(2, 10_000);
    cache.set(cache.makeKey("a", { i: 1 }, "ws"), { i: 1 }, "a", "ws");
    cache.set(cache.makeKey("b", { i: 2 }, "ws"), { i: 2 }, "b", "ws");
    cache.set(cache.makeKey("c", { i: 3 }, "ws"), { i: 3 }, "c", "ws");
    const entries = cache.entryCount();
    assert.equal(entries, 2);
    globalBudgetEngine.applyBudget({ maxCacheEntries: 1 }, "q-cache");
    assert.throws(
      () => globalBudgetEngine.checkCacheEntries("q-cache", undefined, entries),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PLAN_LIMIT_EXCEEDED
    );
  });

  it("quota violations increment observability metrics", () => {
    globalBudgetEngine.applyBudget({ maxProviderCallsPerExecution: 1 }, "q-provider");
    globalBudgetEngine.countProviderCall("q-provider", undefined, "openai");
    assert.throws(() => globalBudgetEngine.countProviderCall("q-provider", undefined, "openai"));
    const snap = globalObservability.getSnapshot();
    assert.ok((snap.budgetViolations ?? []).length >= 1);
    assert.ok((snap.quota?.violations ?? 0) >= 1);
    assert.ok((snap.quota?.checks ?? 0) >= 1);
  });

  it("quota checks route through provider path and do not leak secrets/paths", async () => {
    process.env.LLM_API_KEY = "test-api-key-placeholder";
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 })) as typeof fetch;
    globalBudgetEngine.applyBudget({ maxProviderCallsPerExecution: 5 }, "q-provider");
    const client = new LLMClient({ provider: "openai", model: "gpt-4o-mini" });
    await client.generate({ prompt: "hello" }, createRootTraceContext({ requestId: "q-provider", toolName: "llm" }));

    const out = await metricsSnapshotToolHandler({ includeTimelines: true });
    const dump = out.content[0].text;
    assert.equal(dump.includes("test-api-key-placeholder"), false);
    assert.equal(dump.includes("C:\\Users\\"), false);
    assert.ok(dump.includes("\"quota\""));
  });
});

