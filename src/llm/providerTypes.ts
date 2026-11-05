export type ProviderType =
  | "openai"
  | "openai_compatible"
  | "anthropic"
  | "gemini"
  | "ollama";

export interface ProviderConfig {
  provider: ProviderType;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface LLMRequest {
  prompt: string;
}

export interface LLMResponse {
  text: string;
}

export interface LLMProvider {
  readonly provider: ProviderType;
  generate(req: LLMRequest, trace?: import("../core/traceContext.js").TraceContext): Promise<LLMResponse>;
}
