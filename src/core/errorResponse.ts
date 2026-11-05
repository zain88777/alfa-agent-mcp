/**
 * P2.8 - Error normalization.
 *
 * Standardized error envelope for all tool execution failures.
 * Every error MUST pass through ToolExecutionErrorClass.
 * Raw Error / string / rejected promise => INTERNAL_ERROR.
 */

export interface ToolExecutionError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
  tool?: string;
  requestId?: string;
  parentRequestId?: string;
}

export class ToolExecutionErrorClass extends Error {
  public readonly code: ErrorCode;
  public readonly retryable: boolean;
  public readonly details?: Record<string, unknown>;
  public readonly tool?: string;
  public readonly requestId?: string;
  public readonly parentRequestId?: string;

  constructor(code: ErrorCode, message: string, options?: {
    retryable?: boolean;
    details?: Record<string, unknown>;
    tool?: string;
    requestId?: string;
    parentRequestId?: string;
  }) {
    super(message);
    this.name = "ToolExecutionError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.details = options?.details;
    this.tool = options?.tool;
    this.requestId = options?.requestId;
    this.parentRequestId = options?.parentRequestId;
  }

  private static readonly ABSOLUTE_PATH_PATTERN = /(?:[A-Za-z]:\\[^\s:;"',)]{2,}|\/(?:Users|home|var|etc|opt|tmp|srv|mnt|proc|root)\/[^\s:;"',)]{2,})/g;
  private static readonly SECRET_KEY_PATTERNS = [
    /api[-_]?key/i,
    /token/i,
    /password/i,
    /secret/i,
    /authorization/i,
    /credential/i,
    /private[-_]?key/i,
  ];

  static sanitizeMessage(raw: string): string {
    let cleaned = raw.replace(/\n\s+at\s+.*/g, "");
    cleaned = cleaned.replace(this.ABSOLUTE_PATH_PATTERN, "[path]");

    const lines = cleaned.split("\n");
    const safeLines = lines.map(line => {
      for (const pattern of this.SECRET_KEY_PATTERNS) {
        if (pattern.test(line)) {
          line = line.replace(
            /\b(api[-_]?key|token|password|secret|authorization|credential|private[-_]?key)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,}]{4,})/gi,
            "$1: [REDACTED]"
          );
        }
      }
      line = line.replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi, "Bearer [REDACTED]");
      return line;
    });

    return safeLines.join("\n");
  }

  static from(error: unknown, options?: {
    defaultTool?: string;
    defaultRequestId?: string;
    defaultParentRequestId?: string;
  }): ToolExecutionErrorClass {
    const { defaultTool, defaultRequestId, defaultParentRequestId } = options ?? {};

    if (error instanceof ToolExecutionErrorClass) {
      const mergedRequestId = error.requestId ?? defaultRequestId;
      const mergedParentRequestId = error.parentRequestId ?? defaultParentRequestId;
      const mergedTool = error.tool ?? defaultTool;
      if (mergedRequestId !== error.requestId || mergedParentRequestId !== error.parentRequestId || mergedTool !== error.tool) {
        return new ToolExecutionErrorClass(error.code, error.message, {
          retryable: error.retryable,
          details: error.details,
          tool: mergedTool,
          requestId: mergedRequestId,
          parentRequestId: mergedParentRequestId,
        });
      }
      return error;
    }

    if (error != null && typeof error === "object" && "issues" in error && "name" in error && (error as { name?: string }).name === "ZodError") {
      const zodErr = error as { issues: Array<{ path: (string | number)[]; message: string }> };
      const formatted = zodErr.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
      return new ToolExecutionErrorClass(
        ErrorCode.VALIDATION_FAILED,
        `Input validation failed: ${formatted}`,
        {
          retryable: false,
          tool: defaultTool,
          requestId: defaultRequestId,
          parentRequestId: defaultParentRequestId,
          details: { issues: zodErr.issues },
        }
      );
    }

    if (error instanceof Error) {
      const safeMessage = this.sanitizeMessage(error.message);
      return new ToolExecutionErrorClass(
        ErrorCode.INTERNAL_ERROR,
        safeMessage || "An unexpected internal error occurred",
        {
          retryable: false,
          details: { originalName: error.name },
          tool: defaultTool,
          requestId: defaultRequestId,
          parentRequestId: defaultParentRequestId,
        }
      );
    }

    if (typeof error === "string") {
      const safeMessage = this.sanitizeMessage(error);
      return new ToolExecutionErrorClass(
        ErrorCode.INTERNAL_ERROR,
        safeMessage || "An unexpected internal error occurred",
        {
          retryable: false,
          tool: defaultTool,
          requestId: defaultRequestId,
          parentRequestId: defaultParentRequestId,
        }
      );
    }

    return new ToolExecutionErrorClass(
      ErrorCode.INTERNAL_ERROR,
      "An unexpected internal error occurred",
      {
        retryable: false,
        details: { originalType: typeof error },
        tool: defaultTool,
        requestId: defaultRequestId,
        parentRequestId: defaultParentRequestId,
      }
    );
  }

  toJSON(): ToolExecutionError {
    const envelope: ToolExecutionError = {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
    if (this.details) envelope.details = this.details;
    if (this.tool) envelope.tool = this.tool;
    if (this.requestId) envelope.requestId = this.requestId;
    if (this.parentRequestId) envelope.parentRequestId = this.parentRequestId;
    return envelope;
  }

  static isSafeForUser(raw: string): boolean {
    if (/\n\s+at\s+/.test(raw)) return false;
    if (this.ABSOLUTE_PATH_PATTERN.test(raw)) return false;
    return true;
  }
}

export interface ToolErrorResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
  error?: ToolExecutionError;
}

export interface ToolSuccessResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
}

export type ToolResponse = ToolSuccessResponse | ToolErrorResponse;

export enum ErrorCode {
  VALIDATION_FAILED = "VALIDATION_FAILED",
  POLICY_DENIED = "POLICY_DENIED",
  APPROVAL_REQUIRED = "APPROVAL_REQUIRED",
  APPROVAL_EXPIRED = "APPROVAL_EXPIRED",
  TOOL_NOT_FOUND = "TOOL_NOT_FOUND",
  EXECUTION_TIMEOUT = "EXECUTION_TIMEOUT",
  CANCELLED = "CANCELLED",
  PATH_DENIED = "PATH_DENIED",
  COMMAND_DENIED = "COMMAND_DENIED",
  COMMAND_FAILED = "COMMAND_FAILED",
  PLAN_LIMIT_EXCEEDED = "PLAN_LIMIT_EXCEEDED",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  CONFIG_INVALID = "CONFIG_INVALID",
  PROVIDER_CONFIG_INVALID = "PROVIDER_CONFIG_INVALID",
  PROVIDER_AUTH_FAILED = "PROVIDER_AUTH_FAILED",
  PROVIDER_RATE_LIMITED = "PROVIDER_RATE_LIMITED",
  PROVIDER_TIMEOUT = "PROVIDER_TIMEOUT",
  PROVIDER_NETWORK_ERROR = "PROVIDER_NETWORK_ERROR",
  PROVIDER_BAD_RESPONSE = "PROVIDER_BAD_RESPONSE",
  SCREEN_AGENT_BRIDGE_UNAVAILABLE = "SCREEN_AGENT_BRIDGE_UNAVAILABLE",
}

export function createErrorResponse(
  message: string,
  code: ErrorCode = ErrorCode.INTERNAL_ERROR,
  details?: Record<string, unknown>,
  retryable = false,
  tool?: string
): ToolErrorResponse {
  return {
    content: [
      {
        type: "text",
        text: `Error [${code}]: ${message}`,
      },
    ],
    error: {
      code,
      message,
      retryable,
      details,
      tool,
    },
  };
}

export function createSuccessResponse(data: string | object): ToolSuccessResponse {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}

export function isErrorResponse(response: ToolResponse): response is ToolErrorResponse {
  return (response as ToolErrorResponse).error !== undefined;
}
