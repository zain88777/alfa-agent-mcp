import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { initSystem } from "../src/core/initSystem.js";
import { loadRuntimeConfig } from "../src/core/runtimeConfig.js";
import { ErrorCode, ToolExecutionErrorClass } from "../src/core/errorResponse.js";
import { createRootTraceContext } from "../src/core/traceContext.js";
import { LLMClient } from "../src/llm/llmClient.js";
import { globalObservability } from "../src/core/observability.js";
import { PolicyEngine, PolicyTier } from "../src/core/policyEngine.js";
import { ApprovalEngine } from "../src/core/approvalEngine.js";
import { ToolRegistry } from "../src/core/toolRegistry.js";

const realFetch = globalThis.fetch;

function hasSchemaLike(x: unknown): boolean {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.safeParse === "function" || typeof o.parse === "function";
}

describe("P3.13 Final runtime integration & smoke", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_TIMEOUT_MS;
    globalThis.fetch = realFetch;
    globalObservability.reset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = realFetch;
  });

  it("end-to-end runtime path smoke", async () => {
    process.env.LLM_API_KEY = "test-api-key-placeholder";
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "provider-ok" } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;

    const runtimeConfig = loadRuntimeConfig();
    assert.equal(runtimeConfig.provider.provider, "openai");

    const registry = new ToolRegistry(
      new PolicyEngine(new Map([
        ["smoke_read", { tier: PolicyTier.READ_ONLY, defaultAllow: true }],
        ["smoke_danger", { tier: PolicyTier.DANGEROUS, defaultAllow: false, requiresApproval: true }],
      ])),
      new ApprovalEngine()
    );
    registry.register("smoke_read", async () => ({ content: [{ type: "text" as const, text: "ok" }] }));
    registry.register("smoke_danger", async () => ({ content: [{ type: "text" as const, text: "should-not-run" }] }));

    const trace = createRootTraceContext({ requestId: "p313-smoke", toolName: "smoke_read" });
    const safeRes = await registry.execute("smoke_read", {}, "p313-smoke", 0, undefined, trace);
    assert.ok(Array.isArray((safeRes as { content?: unknown[] }).content));

    await assert.rejects(
      () => registry.execute("smoke_danger", {}, "p313-deny", 0, undefined, trace),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.POLICY_DENIED
    );

    const llm = new LLMClient({ provider: "openai", model: "gpt-4o-mini" });
    const out = await llm.generate({ prompt: "hello" }, trace);
    assert.equal(out.text, "provider-ok");

    const logs = registry.getLogs();
    const readLogs = logs.filter((l) => l.toolName === "smoke_read");
    assert.ok(readLogs.length > 0);
    assert.ok(readLogs.some((l) => l.traceId === trace.traceId));

    const snap = registry.getObservabilitySnapshot();
    assert.equal(typeof snap.totalExecutions, "number");
    assert.equal(typeof snap.errorCountsByCode, "object");
    assert.equal(typeof snap.providerMetrics, "object");
  });

  it("MCP/index integration metadata safety", () => {
    const { registry } = initSystem();
    const defs = registry.listDefinitions();
    assert.ok(defs.length > 0);

    const schematized = defs.find((d) => hasSchemaLike(d.schema));
    assert.ok(schematized);
    assert.ok(!("handler" in (schematized as object)));
    assert.ok(hasSchemaLike(schematized?.schema));

    assert.ok(defs.every((d) => Object.prototype.hasOwnProperty.call(d, "policy")));

    const metadataOnly = defs.map((d) => ({ name: d.name, description: d.description, policy: d.policy }));
    const configString = JSON.stringify(metadataOnly);
    assert.ok(!/(\"api[-_]?key\"\\s*:|\"token\"\\s*:|\"authorization\"\\s*:|\"password\"\\s*:|\"credential\"\\s*:|\"private[-_]?key\"\\s*:)/i.test(configString));
  });

  it("environment matrix smoke", () => {
    const def = loadRuntimeConfig({});
    assert.equal(def.provider.provider, "openai");

    const ollama = loadRuntimeConfig({ LLM_PROVIDER: "ollama", LLM_MODEL: "llama3.1" });
    assert.equal(ollama.provider.provider, "ollama");
    assert.equal(ollama.provider.apiKey, undefined);

    const openai = loadRuntimeConfig({ LLM_PROVIDER: "openai", LLM_MODEL: "gpt-4o-mini", LLM_API_KEY: "test-api-key-placeholder" });
    assert.equal(openai.provider.provider, "openai");
    assert.equal(openai.provider.apiKey, "test-api-key-placeholder");

    assert.throws(
      () => loadRuntimeConfig({ LLM_PROVIDER: "bad_provider" }),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.CONFIG_INVALID
    );

    assert.throws(
      () => loadRuntimeConfig({ LLM_TIMEOUT_MS: "0" }),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.CONFIG_INVALID
    );
  });

  it("final security snapshot/log/error checks", async () => {
    const { registry } = initSystem();

    await assert.rejects(() => registry.execute("delete_file", { filePath: "package.json", apiKey: "test-key-123" }, "p313-sec"));
    const logs = registry.getLogs();
    const dump = JSON.stringify({ logs, health: registry.getHealthSnapshot(), obs: registry.getObservabilitySnapshot() });
    assert.ok(!dump.includes("test-key-123"));

    try {
      loadRuntimeConfig({ LLM_TIMEOUT_MS: "-1", LLM_API_KEY: "test-api-key-placeholder" });
      assert.fail("expected config error");
    } catch (e) {
      assert.ok(e instanceof ToolExecutionErrorClass);
      const d = JSON.stringify(e.details ?? {});
      assert.ok(!d.includes("test-api-key-placeholder"));
      assert.ok(d.includes("[REDACTED]"));
    }

    const health = registry.getHealthSnapshot();
    assert.equal(typeof health.unclassifiedTools, "number");
  });
});
