import type { LLMProvider, LLMRequest, LLMResponse, ProviderConfig } from "./providerTypes.js";
import { createProviderAdapter } from "./providerFactory.js";
import { validateProviderConfig } from "./providerUtils.js";
import type { TraceContext } from "../core/traceContext.js";
import { buildProviderConfig } from "../core/runtimeConfig.js";

export class LLMClient {
  private readonly config: ProviderConfig;
  private readonly provider: LLMProvider;

  constructor(config?: Partial<ProviderConfig>) {
    this.config = buildProviderConfig(config);

    validateProviderConfig(this.config);
    this.provider = createProviderAdapter(this.config);
  }

  getProviderConfig(): ProviderConfig {
    return { ...this.config };
  }

  async generate(req: LLMRequest, trace?: TraceContext): Promise<LLMResponse> {
    return this.provider.generate(req, trace);
  }
}
