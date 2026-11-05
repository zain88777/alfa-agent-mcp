import { ToolExecutionErrorClass, ErrorCode } from "../core/errorResponse.js";
import type { LLMProvider, ProviderConfig, LLMRequest, LLMResponse } from "./providerTypes.js";
import { normalizeProviderError } from "./providerUtils.js";
import type { TraceContext } from "../core/traceContext.js";
import { createChildTraceContext, createRootTraceContext } from "../core/traceContext.js";
import { globalObservability, estimateCost } from "../core/observability.js";
import { globalBudgetEngine } from "../core/budgetEngine.js";
import { globalAuditTrail } from "../core/auditTrail.js";

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function budgetScopeFromTrace(trace?: TraceContext): string | undefined {
  if (!trace) return undefined;
  return trace.parentRequestId ?? trace.requestId;
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

function throwByStatus(status: number, text: string): never {
  const message = `${status} ${ToolExecutionErrorClass.sanitizeMessage(text || "")}`;
  if (status === 401 || status === 403) {
    throw new Error(`AUTH ${message}`);
  }
  if (status === 429) {
    throw new Error(`RATE_LIMIT ${message}`);
  }
  throw new Error(`HTTP ${message}`);
}

class OpenAIStyleProvider implements LLMProvider {
  readonly provider;
  private readonly cfg: ProviderConfig;

  constructor(provider: "openai" | "openai_compatible", cfg: ProviderConfig) {
    this.provider = provider;
    this.cfg = cfg;
  }

  async generate(req: LLMRequest, trace?: TraceContext): Promise<LLMResponse> {
    const baseUrl = this.cfg.baseUrl || "https://api.openai.com/v1";
    const timeoutMs = this.cfg.timeoutMs ?? 60000;
    const start = Date.now();
    const callTrace = trace
      ? createChildTraceContext(trace, { provider: this.provider, model: this.cfg.model })
      : createRootTraceContext({ provider: this.provider, model: this.cfg.model });
    globalAuditTrail.record("provider", "start", { provider: this.provider, model: this.cfg.model, requestId: callTrace.requestId });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: this.cfg.model,
          messages: [
            { role: "system", content: "You are an advanced AI software engineer agent." },
            { role: "user", content: req.prompt },
          ],
          temperature: 0.2,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const txt = await res.text();
        throwByStatus(res.status, txt);
      }

      const data = (await parseJsonSafe(res)) as { choices?: Array<{ message?: { content?: string } }> } | undefined;
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text !== "string") {
        throw new ToolExecutionErrorClass(ErrorCode.PROVIDER_BAD_RESPONSE, "Provider returned an invalid response", {
          retryable: false,
          tool: "llm_provider",
          details: { provider: this.provider },
        });
      }

      const inputTokens = estimateTokens(req.prompt);
      const outputTokens = estimateTokens(text);
      const budgetScope = budgetScopeFromTrace(callTrace);
      if (budgetScope) {
        globalBudgetEngine.countProviderCall(budgetScope, undefined, this.provider);
        globalBudgetEngine.checkTokens(budgetScope, undefined, inputTokens + outputTokens);
        globalBudgetEngine.checkCost(budgetScope, undefined, estimateCost(this.cfg.model, inputTokens, outputTokens));
      }

      const out = { text };
      globalObservability.recordProviderCall({
        provider: this.provider,
        model: this.cfg.model,
        trace: callTrace,
        success: true,
        durationMs: Date.now() - start,
        inputTokens,
        outputTokens,
        requestId: budgetScope,
      });
      globalObservability.recordTimelineSpan({
        type: "provider",
        name: `${this.provider}:${this.cfg.model}`,
        provider: this.provider,
        model: this.cfg.model,
        startTime: start,
        endTime: Date.now(),
        success: true,
        inputTokens,
        outputTokens,
      });
      globalAuditTrail.record("provider", "success", { provider: this.provider, model: this.cfg.model, durationMs: Date.now() - start, inputTokens, outputTokens });
      return out;
    } catch (error) {
      const normalized = normalizeProviderError(error, this.provider, this.cfg);
      globalObservability.recordProviderCall({
        provider: this.provider,
        model: this.cfg.model,
        trace: callTrace,
        success: false,
        durationMs: Date.now() - start,
        errorCode: normalized.code,
      });
      globalObservability.recordTimelineSpan({
        type: "provider",
        name: `${this.provider}:${this.cfg.model}`,
        provider: this.provider,
        model: this.cfg.model,
        startTime: start,
        endTime: Date.now(),
        success: false,
        errorCode: normalized.code,
      });
      globalAuditTrail.record("provider", "failure", { provider: this.provider, model: this.cfg.model, durationMs: Date.now() - start, errorCode: normalized.code });
      throw normalized;
    } finally {
      clearTimeout(timeout);
    }
  }
}

class AnthropicProvider implements LLMProvider {
  readonly provider = "anthropic" as const;
  private readonly cfg: ProviderConfig;
  constructor(cfg: ProviderConfig) { this.cfg = cfg; }

  async generate(req: LLMRequest, trace?: TraceContext): Promise<LLMResponse> {
    const baseUrl = this.cfg.baseUrl || "https://api.anthropic.com/v1";
    const start = Date.now();
    const callTrace = trace
      ? createChildTraceContext(trace, { provider: this.provider, model: this.cfg.model })
      : createRootTraceContext({ provider: this.provider, model: this.cfg.model });
    globalAuditTrail.record("provider", "start", { provider: this.provider, model: this.cfg.model, requestId: callTrace.requestId });
    try {
      const res = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": `${this.cfg.apiKey}`,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.cfg.model,
          max_tokens: 1024,
          messages: [{ role: "user", content: req.prompt }],
        }),
      });

      if (!res.ok) throwByStatus(res.status, await res.text());
      const data = (await parseJsonSafe(res)) as { content?: Array<{ text?: string }> } | undefined;
      const text = data?.content?.[0]?.text;
      if (typeof text !== "string") {
        throw new Error("BAD_RESPONSE anthropic");
      }
      const inputTokens = estimateTokens(req.prompt);
      const outputTokens = estimateTokens(text);
      const budgetScope = budgetScopeFromTrace(callTrace);
      if (budgetScope) {
        globalBudgetEngine.countProviderCall(budgetScope, undefined, this.provider);
        globalBudgetEngine.checkTokens(budgetScope, undefined, inputTokens + outputTokens);
        globalBudgetEngine.checkCost(budgetScope, undefined, estimateCost(this.cfg.model, inputTokens, outputTokens));
      }
      const out = { text };
      globalObservability.recordProviderCall({
        provider: this.provider, model: this.cfg.model, trace: callTrace, success: true, durationMs: Date.now() - start, inputTokens, outputTokens, requestId: budgetScope,
      });
      globalObservability.recordTimelineSpan({
        type: "provider",
        name: `${this.provider}:${this.cfg.model}`,
        provider: this.provider,
        model: this.cfg.model,
        startTime: start,
        endTime: Date.now(),
        success: true,
        inputTokens,
        outputTokens,
      });
      globalAuditTrail.record("provider", "success", { provider: this.provider, model: this.cfg.model, durationMs: Date.now() - start, inputTokens, outputTokens });
      return out;
    } catch (error) {
      const normalized = normalizeProviderError(error, this.provider, this.cfg);
      globalObservability.recordProviderCall({ provider: this.provider, model: this.cfg.model, trace: callTrace, success: false, durationMs: Date.now() - start, errorCode: normalized.code });
      globalObservability.recordTimelineSpan({
        type: "provider",
        name: `${this.provider}:${this.cfg.model}`,
        provider: this.provider,
        model: this.cfg.model,
        startTime: start,
        endTime: Date.now(),
        success: false,
        errorCode: normalized.code,
      });
      globalAuditTrail.record("provider", "failure", { provider: this.provider, model: this.cfg.model, durationMs: Date.now() - start, errorCode: normalized.code });
      throw normalized;
    }
  }
}

class GeminiProvider implements LLMProvider {
  readonly provider = "gemini" as const;
  private readonly cfg: ProviderConfig;
  constructor(cfg: ProviderConfig) { this.cfg = cfg; }

  async generate(req: LLMRequest, trace?: TraceContext): Promise<LLMResponse> {
    const baseUrl = this.cfg.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
    const start = Date.now();
    const callTrace = trace
      ? createChildTraceContext(trace, { provider: this.provider, model: this.cfg.model })
      : createRootTraceContext({ provider: this.provider, model: this.cfg.model });
    globalAuditTrail.record("provider", "start", { provider: this.provider, model: this.cfg.model, requestId: callTrace.requestId });
    try {
      const res = await fetch(`${baseUrl}/models/${encodeURIComponent(this.cfg.model)}:generateContent?key=${encodeURIComponent(this.cfg.apiKey || "")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: req.prompt }] }],
        }),
      });

      if (!res.ok) throwByStatus(res.status, await res.text());
      const data = (await parseJsonSafe(res)) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } | undefined;
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== "string") {
        throw new Error("BAD_RESPONSE gemini");
      }
      const inputTokens = estimateTokens(req.prompt);
      const outputTokens = estimateTokens(text);
      const budgetScope = budgetScopeFromTrace(callTrace);
      if (budgetScope) {
        globalBudgetEngine.countProviderCall(budgetScope, undefined, this.provider);
        globalBudgetEngine.checkTokens(budgetScope, undefined, inputTokens + outputTokens);
        globalBudgetEngine.checkCost(budgetScope, undefined, estimateCost(this.cfg.model, inputTokens, outputTokens));
      }
      const out = { text };
      globalObservability.recordProviderCall({
        provider: this.provider, model: this.cfg.model, trace: callTrace, success: true, durationMs: Date.now() - start, inputTokens, outputTokens, requestId: budgetScope,
      });
      globalObservability.recordTimelineSpan({
        type: "provider",
        name: `${this.provider}:${this.cfg.model}`,
        provider: this.provider,
        model: this.cfg.model,
        startTime: start,
        endTime: Date.now(),
        success: true,
        inputTokens,
        outputTokens,
      });
      globalAuditTrail.record("provider", "success", { provider: this.provider, model: this.cfg.model, durationMs: Date.now() - start, inputTokens, outputTokens });
      return out;
    } catch (error) {
      const normalized = normalizeProviderError(error, this.provider, this.cfg);
      globalObservability.recordProviderCall({ provider: this.provider, model: this.cfg.model, trace: callTrace, success: false, durationMs: Date.now() - start, errorCode: normalized.code });
      globalObservability.recordTimelineSpan({
        type: "provider",
        name: `${this.provider}:${this.cfg.model}`,
        provider: this.provider,
        model: this.cfg.model,
        startTime: start,
        endTime: Date.now(),
        success: false,
        errorCode: normalized.code,
      });
      globalAuditTrail.record("provider", "failure", { provider: this.provider, model: this.cfg.model, durationMs: Date.now() - start, errorCode: normalized.code });
      throw normalized;
    }
  }
}

class OllamaProvider implements LLMProvider {
  readonly provider = "ollama" as const;
  private readonly cfg: ProviderConfig;
  constructor(cfg: ProviderConfig) { this.cfg = cfg; }

  async generate(req: LLMRequest, trace?: TraceContext): Promise<LLMResponse> {
    const baseUrl = this.cfg.baseUrl || "http://localhost:11434";
    const start = Date.now();
    const callTrace = trace
      ? createChildTraceContext(trace, { provider: this.provider, model: this.cfg.model })
      : createRootTraceContext({ provider: this.provider, model: this.cfg.model });
    globalAuditTrail.record("provider", "start", { provider: this.provider, model: this.cfg.model, requestId: callTrace.requestId });
    try {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.cfg.model,
          prompt: req.prompt,
          stream: false,
        }),
      });

      if (!res.ok) throwByStatus(res.status, await res.text());
      const data = (await parseJsonSafe(res)) as { response?: string } | undefined;
      if (typeof data?.response !== "string") {
        throw new Error("BAD_RESPONSE ollama");
      }
      const inputTokens = estimateTokens(req.prompt);
      const outputTokens = estimateTokens(data.response);
      const budgetScope = budgetScopeFromTrace(callTrace);
      if (budgetScope) {
        globalBudgetEngine.countProviderCall(budgetScope, undefined, this.provider);
        globalBudgetEngine.checkTokens(budgetScope, undefined, inputTokens + outputTokens);
        globalBudgetEngine.checkCost(budgetScope, undefined, estimateCost(this.cfg.model, inputTokens, outputTokens));
      }
      const out = { text: data.response };
      globalObservability.recordProviderCall({
        provider: this.provider, model: this.cfg.model, trace: callTrace, success: true, durationMs: Date.now() - start, inputTokens, outputTokens, requestId: budgetScope,
      });
      globalObservability.recordTimelineSpan({
        type: "provider",
        name: `${this.provider}:${this.cfg.model}`,
        provider: this.provider,
        model: this.cfg.model,
        startTime: start,
        endTime: Date.now(),
        success: true,
        inputTokens,
        outputTokens,
      });
      globalAuditTrail.record("provider", "success", { provider: this.provider, model: this.cfg.model, durationMs: Date.now() - start, inputTokens, outputTokens });
      return out;
    } catch (error) {
      const normalized = normalizeProviderError(error, this.provider, this.cfg);
      globalObservability.recordProviderCall({ provider: this.provider, model: this.cfg.model, trace: callTrace, success: false, durationMs: Date.now() - start, errorCode: normalized.code });
      globalObservability.recordTimelineSpan({
        type: "provider",
        name: `${this.provider}:${this.cfg.model}`,
        provider: this.provider,
        model: this.cfg.model,
        startTime: start,
        endTime: Date.now(),
        success: false,
        errorCode: normalized.code,
      });
      globalAuditTrail.record("provider", "failure", { provider: this.provider, model: this.cfg.model, durationMs: Date.now() - start, errorCode: normalized.code });
      throw normalized;
    }
  }
}

export function createProviderAdapter(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case "openai":
      return new OpenAIStyleProvider("openai", config);
    case "openai_compatible":
      return new OpenAIStyleProvider("openai_compatible", config);
    case "anthropic":
      return new AnthropicProvider(config);
    case "gemini":
      return new GeminiProvider(config);
    case "ollama":
      return new OllamaProvider(config);
    default:
      throw new ToolExecutionErrorClass(
        ErrorCode.PROVIDER_CONFIG_INVALID,
        `Unsupported provider '${String((config as { provider?: unknown }).provider)}'`,
        { retryable: false, tool: "llm_provider" }
      );
  }
}
