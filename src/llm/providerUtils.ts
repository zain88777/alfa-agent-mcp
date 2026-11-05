import { ErrorCode, ToolExecutionErrorClass } from "../core/errorResponse.js";
import type { ProviderConfig, ProviderType } from "./providerTypes.js";

const SECRET_KEYS = ["apiKey", "token", "authorization", "secret", "key"];

export function redactProviderConfig(config: ProviderConfig): Record<string, unknown> {
  const configRecord = config as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
  };

  for (const k of SECRET_KEYS) {
    if (k in configRecord) {
      out[k] = "[REDACTED]";
    }
  }

  return out;
}

export function validateProviderConfig(config: ProviderConfig): void {
  const providers: ProviderType[] = ["openai", "openai_compatible", "anthropic", "gemini", "ollama"];
  if (!providers.includes(config.provider)) {
    throw new ToolExecutionErrorClass(
      ErrorCode.PROVIDER_CONFIG_INVALID,
      `Unsupported provider '${String((config as { provider?: unknown }).provider)}'`,
      { retryable: false, details: { config: redactProviderConfig(config) }, tool: "llm_provider" }
    );
  }

  if (!config.model || typeof config.model !== "string") {
    throw new ToolExecutionErrorClass(
      ErrorCode.PROVIDER_CONFIG_INVALID,
      "Provider model is required",
      { retryable: false, details: { config: redactProviderConfig(config) }, tool: "llm_provider" }
    );
  }

  const requiresApiKey = config.provider !== "ollama";
  if (requiresApiKey && (!config.apiKey || typeof config.apiKey !== "string")) {
    throw new ToolExecutionErrorClass(
      ErrorCode.PROVIDER_AUTH_FAILED,
      `API key is required for provider '${config.provider}'`,
      { retryable: false, details: { config: redactProviderConfig(config) }, tool: "llm_provider" }
    );
  }
}

export function normalizeProviderError(error: unknown, provider: ProviderType, config: ProviderConfig): ToolExecutionErrorClass {
  if (error instanceof ToolExecutionErrorClass) {
    return error;
  }

  const details = { provider, config: redactProviderConfig(config) };

  if (error instanceof DOMException && error.name === "AbortError") {
    return new ToolExecutionErrorClass(ErrorCode.PROVIDER_TIMEOUT, "Provider request timed out", {
      retryable: true,
      tool: "llm_provider",
      details,
    });
  }

  if (error instanceof Error) {
    const message = ToolExecutionErrorClass.sanitizeMessage(error.message);

    if (/401|403|unauthori[sz]ed|invalid api key|forbidden/i.test(message)) {
      return new ToolExecutionErrorClass(ErrorCode.PROVIDER_AUTH_FAILED, "Provider authentication failed", {
        retryable: false,
        tool: "llm_provider",
        details,
      });
    }

    if (/429|rate limit|too many requests/i.test(message)) {
      return new ToolExecutionErrorClass(ErrorCode.PROVIDER_RATE_LIMITED, "Provider rate limit exceeded", {
        retryable: true,
        tool: "llm_provider",
        details,
      });
    }

    if (/timed out|timeout/i.test(message)) {
      return new ToolExecutionErrorClass(ErrorCode.PROVIDER_TIMEOUT, "Provider request timed out", {
        retryable: true,
        tool: "llm_provider",
        details,
      });
    }

    if (/fetch|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/i.test(message)) {
      return new ToolExecutionErrorClass(ErrorCode.PROVIDER_NETWORK_ERROR, "Provider network error", {
        retryable: true,
        tool: "llm_provider",
        details,
      });
    }

    return new ToolExecutionErrorClass(ErrorCode.PROVIDER_BAD_RESPONSE, "Provider returned an invalid response", {
      retryable: false,
      tool: "llm_provider",
      details,
    });
  }

  return new ToolExecutionErrorClass(ErrorCode.PROVIDER_BAD_RESPONSE, "Provider returned an invalid response", {
    retryable: false,
    tool: "llm_provider",
    details,
  });
}
