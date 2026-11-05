import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadRuntimeConfig } from "../src/core/runtimeConfig.js";
import { ErrorCode, ToolExecutionErrorClass } from "../src/core/errorResponse.js";
import { LLMClient } from "../src/llm/llmClient.js";

describe("P3.12 Runtime configuration & environment safety", () => {
  it("loads valid default config", () => {
    const cfg = loadRuntimeConfig({});
    assert.equal(cfg.provider.provider, "openai");
    assert.equal(cfg.provider.model, "gpt-4o-mini");
    assert.equal(cfg.debugMode, false);
    assert.equal(cfg.timeouts.toolMs, 30000);
    assert.equal(cfg.policy.maxPlanSteps, 50);
    assert.equal(cfg.observability.recentTraceLimit, 100);
  });

  it("rejects missing apiKey only for providers that require it", () => {
    assert.throws(
      () => new LLMClient({ provider: "openai", model: "gpt-4o-mini", apiKey: undefined }),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PROVIDER_AUTH_FAILED
    );

    const ollamaClient = new LLMClient({ provider: "ollama", model: "llama3.1" });
    assert.equal(ollamaClient.getProviderConfig().provider, "ollama");
  });

  it("rejects invalid timeout with CONFIG_INVALID", () => {
    assert.throws(
      () => loadRuntimeConfig({ LLM_TIMEOUT_MS: "-5" }),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.CONFIG_INVALID
    );
  });

  it("rejects invalid provider with CONFIG_INVALID", () => {
    assert.throws(
      () => loadRuntimeConfig({ LLM_PROVIDER: "not_real" }),
      (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.CONFIG_INVALID
    );
  });

  it("redacts secrets in config validation errors", () => {
    try {
      loadRuntimeConfig({
        LLM_TIMEOUT_MS: "bad-int",
        LLM_API_KEY: "test-api-key-placeholder",
        AUTHORIZATION: "Bearer token123",
        SOME_SECRET: "hidden",
      });
      assert.fail("expected config error");
    } catch (e) {
      assert.ok(e instanceof ToolExecutionErrorClass);
      assert.equal(e.code, ErrorCode.CONFIG_INVALID);
      const dumped = JSON.stringify(e.details ?? {});
      assert.ok(!dumped.includes("test-api-key-placeholder"));
      assert.ok(!dumped.includes("token123"));
      assert.ok(!dumped.includes("hidden"));
      assert.ok(dumped.includes("[REDACTED]"));
    }
  });

  it("debug mode is disabled by default", () => {
    const cfg = loadRuntimeConfig({});
    assert.equal(cfg.debugMode, false);
  });

  it("supports env overrides", () => {
    const cfg = loadRuntimeConfig({
      ALFA_WORKSPACE_ROOT: ".",
      ALFA_DEBUG: "true",
      ALFA_TOOL_TIMEOUT_MS: "45000",
      ALFA_MAX_PLAN_STEPS: "75",
      ALFA_MAX_PLAN_DEPTH: "7",
      ALFA_APPROVAL_EXPIRY_MS: "120000",
      ALFA_OBSERVABILITY_RECENT_TRACE_LIMIT: "25",
      LLM_PROVIDER: "openai_compatible",
      LLM_MODEL: "custom-model",
      LLM_BASE_URL: "http://localhost:8080/v1/",
      LLM_TIMEOUT_MS: "65000",
      MCP_ALLOW_DANGEROUS_TOOLS: "yes",
    });

    assert.equal(cfg.debugMode, true);
    assert.equal(cfg.timeouts.toolMs, 45000);
    assert.equal(cfg.policy.maxPlanSteps, 75);
    assert.equal(cfg.policy.maxPlanDepth, 7);
    assert.equal(cfg.policy.approvalExpiryMs, 120000);
    assert.equal(cfg.observability.recentTraceLimit, 25);
    assert.equal(cfg.provider.provider, "openai_compatible");
    assert.equal(cfg.provider.model, "custom-model");
    assert.equal(cfg.provider.baseUrl, "http://localhost:8080/v1");
    assert.equal(cfg.provider.timeoutMs, 65000);
    assert.equal(cfg.mcp.allowDangerousTools, true);
  });

  it("MCP_ALLOW_DANGEROUS_TOOLS only accepts true/1/yes/on", () => {
    assert.equal(loadRuntimeConfig({ MCP_ALLOW_DANGEROUS_TOOLS: "true" }).mcp.allowDangerousTools, true);
    assert.equal(loadRuntimeConfig({ MCP_ALLOW_DANGEROUS_TOOLS: "1" }).mcp.allowDangerousTools, true);
    assert.equal(loadRuntimeConfig({ MCP_ALLOW_DANGEROUS_TOOLS: "yes" }).mcp.allowDangerousTools, true);
    assert.equal(loadRuntimeConfig({ MCP_ALLOW_DANGEROUS_TOOLS: "on" }).mcp.allowDangerousTools, true);
    assert.equal(loadRuntimeConfig({ MCP_ALLOW_DANGEROUS_TOOLS: "false" }).mcp.allowDangerousTools, false);
    assert.equal(loadRuntimeConfig({ MCP_ALLOW_DANGEROUS_TOOLS: "0" }).mcp.allowDangerousTools, false);
    assert.equal(loadRuntimeConfig({ MCP_ALLOW_DANGEROUS_TOOLS: "no" }).mcp.allowDangerousTools, false);
    assert.equal(loadRuntimeConfig({ MCP_ALLOW_DANGEROUS_TOOLS: "off" }).mcp.allowDangerousTools, false);
    assert.equal(loadRuntimeConfig({ MCP_ALLOW_DANGEROUS_TOOLS: "random" }).mcp.allowDangerousTools, false);
  });

  it("does not leak raw process.env-like payloads in error details", () => {
    try {
      loadRuntimeConfig({
        LLM_TIMEOUT_MS: "0",
        LLM_API_KEY: "test-api-key-placeholder",
        TOKEN: "abc123",
        PASSWORD: "pw",
        PRIVATEKEY: "private",
      });
      assert.fail("expected error");
    } catch (e) {
      assert.ok(e instanceof ToolExecutionErrorClass);
      const dumped = JSON.stringify(e.details ?? {});
      assert.ok(!dumped.includes("test-api-key-placeholder"));
      assert.ok(!dumped.includes("abc123"));
      assert.ok(!dumped.includes("private"));
      assert.ok(!dumped.includes("pw"));
    }
  });
});
