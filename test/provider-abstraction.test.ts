import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { LLMClient } from "../src/llm/llmClient.js";
import { ErrorCode, ToolExecutionErrorClass } from "../src/core/errorResponse.js";

const realFetch = globalThis.fetch;

describe("P3.10 Provider abstraction", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_API_KEY;
    globalThis.fetch = realFetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = realFetch;
  });

  it("selects default OpenAI provider", () => {
    process.env.LLM_API_KEY = "test-api-key-placeholder";
    const client = new LLMClient();
    const cfg = client.getProviderConfig();
    assert.equal(cfg.provider, "openai");
    assert.equal(cfg.model, "gpt-4o-mini");
  });

  it("supports OpenAI-compatible baseUrl", async () => {
    let seenUrl = "";
    process.env.LLM_API_KEY = "test-api-key-placeholder";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seenUrl = String(input);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;

    const client = new LLMClient({
      provider: "openai_compatible",
      baseUrl: "http://localhost:9000/v1",
      model: "foo-model",
      apiKey: "test-api-key-placeholder",
    });

    const res = await client.generate({ prompt: "hi" });
    assert.equal(res.text, "ok");
    assert.equal(seenUrl, "http://localhost:9000/v1/chat/completions");
  });

  it("rejects missing apiKey where required", () => {
    assert.throws(
      () => new LLMClient({ provider: "anthropic", model: "claude-3-5-sonnet" }),
      (error: unknown) => {
        if (!(error instanceof ToolExecutionErrorClass)) return false;
        return error.code === ErrorCode.PROVIDER_AUTH_FAILED;
      }
    );
  });

  it("does not require apiKey for ollama", () => {
    const client = new LLMClient({ provider: "ollama", model: "llama3.1" });
    const cfg = client.getProviderConfig();
    assert.equal(cfg.provider, "ollama");
  });

  it("rejects invalid provider", () => {
    assert.throws(
      () => new LLMClient({ provider: "invalid_provider" as "openai", model: "x" }),
      (error: unknown) => {
        if (!(error instanceof ToolExecutionErrorClass)) return false;
        return error.code === ErrorCode.PROVIDER_CONFIG_INVALID;
      }
    );
  });

  it("normalizes provider errors safely and redacts apiKey", async () => {
    process.env.LLM_API_KEY = "test-api-key-placeholder";
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed for apiKey=test-api-key-placeholder");
    }) as typeof fetch;

    const client = new LLMClient({ provider: "openai", model: "gpt-4o-mini" });

    await assert.rejects(
      () => client.generate({ prompt: "hi" }),
      (error: unknown) => {
        if (!(error instanceof ToolExecutionErrorClass)) return false;
        if (error.code !== ErrorCode.PROVIDER_NETWORK_ERROR) return false;
        if (error.message.includes("test-api-key-placeholder")) return false;
        const details = error.details as { config?: Record<string, unknown> } | undefined;
        return details?.config?.apiKey === "[REDACTED]";
      }
    );
  });

  it("maps auth/rate/timeout/bad-response provider errors", async () => {
    process.env.LLM_API_KEY = "test-api-key-placeholder";

    globalThis.fetch = (async () => new Response("unauthorized", { status: 401 })) as typeof fetch;
    const c1 = new LLMClient({ provider: "openai", model: "gpt-4o-mini" });
    await assert.rejects(() => c1.generate({ prompt: "a" }), (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PROVIDER_AUTH_FAILED);

    globalThis.fetch = (async () => new Response("rate limited", { status: 429 })) as typeof fetch;
    const c2 = new LLMClient({ provider: "openai", model: "gpt-4o-mini" });
    await assert.rejects(() => c2.generate({ prompt: "a" }), (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PROVIDER_RATE_LIMITED);

    globalThis.fetch = (async () => { throw new DOMException("aborted", "AbortError"); }) as typeof fetch;
    const cTimeout = new LLMClient({ provider: "openai", model: "gpt-4o-mini" });
    await assert.rejects(() => cTimeout.generate({ prompt: "a" }), (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PROVIDER_TIMEOUT);

    globalThis.fetch = (async () => new Response(JSON.stringify({ nope: true }), { status: 200 })) as typeof fetch;
    const c3 = new LLMClient({ provider: "openai", model: "gpt-4o-mini" });
    await assert.rejects(() => c3.generate({ prompt: "a" }), (e: unknown) => e instanceof ToolExecutionErrorClass && e.code === ErrorCode.PROVIDER_BAD_RESPONSE);
  });
});
