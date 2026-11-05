import path from "path";
import { z } from "zod";
import { ErrorCode, ToolExecutionErrorClass } from "./errorResponse.js";
import type { ProviderConfig, ProviderType } from "../llm/providerTypes.js";

const PROVIDERS = ["openai", "openai_compatible", "anthropic", "gemini", "ollama"] as const;

const SECRET_PATTERN = /(api[-_]?key|token|authorization|secret|password|credential|private[-_]?key|key)/i;

export interface RuntimeConfig {
  provider: ProviderConfig;
  workspaceRoot: string;
  bridgePort: number;
  debugMode: boolean;
  timeouts: {
    toolMs: number;
    providerMs: number;
  };
  policy: {
    maxPlanSteps: number;
    maxPlanDepth: number;
    maxConsecutiveFailures: number;
    approvalExpiryMs: number;
  };
  observability: {
    recentTraceLimit: number;
  };
  screenAgent: {
    enabled: boolean;
    approvalTimeoutMs: number;
    actionRateLimitPerMin: number;
    observeMaxDimension: number;
    observeJpegQuality: number;
    bridgeUrl?: string;
    bridgeToken?: string;
  };
  mcp: {
    apiToken?: string;
    disableAuth: boolean;
    allowDangerousTools: boolean;
  };
  oauth: {
    issuer?: string;
    approvedClientIds: string[];
    accessTokenTtlSec: number;
    authCodeTtlSec: number;
    statePath?: string;
  };
}

const runtimeSchema = z.object({
  provider: z.object({
    provider: z.enum(PROVIDERS),
    model: z.string().min(1),
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
    timeoutMs: z.number().int().min(1000).max(300000),
  }),
  workspaceRoot: z.string().min(1),
  bridgePort: z.number().int().min(1).max(65535),
  debugMode: z.boolean(),
  timeouts: z.object({
    toolMs: z.number().int().min(1000).max(300000),
    providerMs: z.number().int().min(1000).max(300000),
  }),
  policy: z.object({
    maxPlanSteps: z.number().int().min(1).max(500),
    maxPlanDepth: z.number().int().min(1).max(20),
    maxConsecutiveFailures: z.number().int().min(1).max(50),
    approvalExpiryMs: z.number().int().min(1000).max(86_400_000),
  }),
  observability: z.object({
    recentTraceLimit: z.number().int().min(1).max(1000),
  }),
  screenAgent: z.object({
    enabled: z.boolean(),
    approvalTimeoutMs: z.number().int().min(1000).max(600000),
    actionRateLimitPerMin: z.number().int().min(1).max(600),
    observeMaxDimension: z.number().int().min(320).max(4096),
    observeJpegQuality: z.number().int().min(20).max(95),
    bridgeUrl: z.string().url().optional(),
    bridgeToken: z.string().min(1).optional(),
  }),
  mcp: z.object({
    apiToken: z.string().min(1).optional(),
    disableAuth: z.boolean(),
    allowDangerousTools: z.boolean(),
  }),
  oauth: z.object({
    issuer: z.string().url().optional(),
    approvedClientIds: z.array(z.string().min(1)),
    accessTokenTtlSec: z.number().int().min(60).max(3600),
    authCodeTtlSec: z.number().int().min(30).max(1800),
    statePath: z.string().min(1).optional(),
  }),
});

const DEFAULTS = {
  provider: {
    provider: "openai" as ProviderType,
    model: "gpt-4o-mini",
    baseUrl: undefined,
    timeoutMs: 60_000,
  },
  timeouts: {
    toolMs: 30_000,
    providerMs: 60_000,
  },
  policy: {
    maxPlanSteps: 50,
    maxPlanDepth: 5,
    maxConsecutiveFailures: 3,
    approvalExpiryMs: 5 * 60 * 1000,
  },
  observability: {
    recentTraceLimit: 100,
  },
  debugMode: false,
  bridgePort: 9223,
  screenAgent: {
    enabled: false,
    approvalTimeoutMs: 120000,
    actionRateLimitPerMin: 60,
    observeMaxDimension: 1280,
    observeJpegQuality: 70,
    bridgeUrl: undefined,
    bridgeToken: undefined,
  },
  mcp: {
    apiToken: undefined,
    disableAuth: false,
    allowDangerousTools: false,
  },
  oauth: {
    issuer: undefined,
    approvedClientIds: [],
    accessTokenTtlSec: 600,
    authCodeTtlSec: 300,
    statePath: undefined,
  },
} as const;

function parseCsvEnv(env: Record<string, string | undefined>, key: string): string[] | undefined {
  const value = env[key];
  if (!value) return undefined;
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

function parseIntEnv(env: Record<string, string | undefined>, key: string): number | undefined {
  const value = env[key];
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseBoolEnv(env: Record<string, string | undefined>, key: string): boolean | undefined {
  const value = env[key];
  if (value === undefined) return undefined;
  return value.toLowerCase() === "true";
}

function parseFlagEnv(env: Record<string, string | undefined>, key: string): boolean | undefined {
  const value = env[key];
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function redactSecrets(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(redactSecrets);
  if (typeof obj !== "object") return obj;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (SECRET_PATTERN.test(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactSecrets(v);
    }
  }
  return out;
}

function normalizeBaseUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  return raw.trim().replace(/\/+$/, "");
}

export function loadRuntimeConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  const providerType = (env.LLM_PROVIDER as ProviderType | undefined) ?? DEFAULTS.provider.provider;
  const cfg = {
    provider: {
      provider: providerType,
      model: env.LLM_MODEL ?? DEFAULTS.provider.model,
      apiKey: env.LLM_API_KEY,
      baseUrl: normalizeBaseUrl(env.LLM_BASE_URL),
      timeoutMs: parseIntEnv(env, "LLM_TIMEOUT_MS") ?? DEFAULTS.provider.timeoutMs,
    },
    workspaceRoot: path.resolve(env.ALFA_WORKSPACE_ROOT || process.cwd()),
    bridgePort: parseIntEnv(env, "BRIDGE_PORT") ?? DEFAULTS.bridgePort,
    debugMode: parseBoolEnv(env, "ALFA_DEBUG") ?? DEFAULTS.debugMode,
    timeouts: {
      toolMs: parseIntEnv(env, "ALFA_TOOL_TIMEOUT_MS") ?? DEFAULTS.timeouts.toolMs,
      providerMs: parseIntEnv(env, "LLM_TIMEOUT_MS") ?? DEFAULTS.timeouts.providerMs,
    },
    policy: {
      maxPlanSteps: parseIntEnv(env, "ALFA_MAX_PLAN_STEPS") ?? DEFAULTS.policy.maxPlanSteps,
      maxPlanDepth: parseIntEnv(env, "ALFA_MAX_PLAN_DEPTH") ?? DEFAULTS.policy.maxPlanDepth,
      maxConsecutiveFailures: parseIntEnv(env, "ALFA_MAX_CONSECUTIVE_FAILURES") ?? DEFAULTS.policy.maxConsecutiveFailures,
      approvalExpiryMs: parseIntEnv(env, "ALFA_APPROVAL_EXPIRY_MS") ?? DEFAULTS.policy.approvalExpiryMs,
    },
    observability: {
      recentTraceLimit: parseIntEnv(env, "ALFA_OBSERVABILITY_RECENT_TRACE_LIMIT") ?? DEFAULTS.observability.recentTraceLimit,
    },
    screenAgent: {
      enabled: parseBoolEnv(env, "ENABLE_SCREEN_AGENT") ?? DEFAULTS.screenAgent.enabled,
      approvalTimeoutMs: parseIntEnv(env, "SCREEN_AGENT_APPROVAL_TIMEOUT_MS") ?? DEFAULTS.screenAgent.approvalTimeoutMs,
      actionRateLimitPerMin: parseIntEnv(env, "SCREEN_AGENT_ACTION_RATE_LIMIT_PER_MIN") ?? DEFAULTS.screenAgent.actionRateLimitPerMin,
      observeMaxDimension: parseIntEnv(env, "SCREEN_AGENT_OBSERVE_MAX_DIMENSION") ?? DEFAULTS.screenAgent.observeMaxDimension,
      observeJpegQuality: parseIntEnv(env, "SCREEN_AGENT_OBSERVE_JPEG_QUALITY") ?? DEFAULTS.screenAgent.observeJpegQuality,
      bridgeUrl: normalizeBaseUrl(env.SCREEN_AGENT_BRIDGE_URL),
      bridgeToken: env.SCREEN_AGENT_BRIDGE_TOKEN?.trim() || undefined,
    },
    mcp: {
      apiToken: env.MCP_API_TOKEN?.trim() || undefined,
      disableAuth: parseBoolEnv(env, "MCP_DISABLE_AUTH") ?? DEFAULTS.mcp.disableAuth,
      allowDangerousTools: parseFlagEnv(env, "MCP_ALLOW_DANGEROUS_TOOLS") ?? DEFAULTS.mcp.allowDangerousTools,
    },
    oauth: {
      issuer: env.MCP_OAUTH_ISSUER?.trim() || DEFAULTS.oauth.issuer,
      approvedClientIds: parseCsvEnv(env, "MCP_OAUTH_APPROVED_CLIENT_IDS") ?? DEFAULTS.oauth.approvedClientIds,
      accessTokenTtlSec: parseIntEnv(env, "MCP_OAUTH_ACCESS_TOKEN_TTL_SEC") ?? DEFAULTS.oauth.accessTokenTtlSec,
      authCodeTtlSec: parseIntEnv(env, "MCP_OAUTH_AUTH_CODE_TTL_SEC") ?? DEFAULTS.oauth.authCodeTtlSec,
      statePath: env.MCP_OAUTH_STATE_PATH?.trim() || DEFAULTS.oauth.statePath,
    },
  };

  const parsed = runtimeSchema.safeParse(cfg);
  if (!parsed.success) {
    throw new ToolExecutionErrorClass(
      ErrorCode.CONFIG_INVALID,
      "Runtime configuration is invalid",
      {
        retryable: false,
        tool: "runtime_config",
        details: {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          config: redactSecrets(cfg),
        },
      }
    );
  }

  return parsed.data;
}

export function buildProviderConfig(overrides?: Partial<ProviderConfig>, env: Record<string, string | undefined> = process.env): ProviderConfig {
  const runtime = loadRuntimeConfig(env);
  return {
    provider: overrides?.provider ?? runtime.provider.provider,
    model: overrides?.model ?? runtime.provider.model,
    apiKey: overrides?.apiKey ?? runtime.provider.apiKey,
    baseUrl: overrides?.baseUrl ?? runtime.provider.baseUrl,
    timeoutMs: overrides?.timeoutMs ?? runtime.provider.timeoutMs,
  };
}
