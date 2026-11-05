/**
 * Execution context for tool invocation.
 *
 * Every tool call passes through this context, providing:
 * - requestId for end-to-end correlation
 * - AbortSignal for cancellation propagation
 * - Logger scoped to this execution
 * - Execution metadata for observability
 * - Execution depth tracking (plan nesting)
 * - Policy tier for approval context
 *
 * CONTEXT INHERITANCE RULES:
 * - requestId lineage: parent → child (parentRequestId traces the chain)
 * - policy state: inherited by default, child can request stricter
 * - cancellation state: child AbortController is linked to parent's signal
 * - approval state: inherited, child CANNOT bypass parent's pending/denied approvals
 *   Dangerous tools do NOT inherit parent approval — must get own approval
 * - execution depth: incremented on nested execute, max enforced by plan executor
 */

import { randomUUID } from "crypto";
import { ErrorCode, ToolExecutionErrorClass } from "./errorResponse.js";
import { PolicyTier } from "./policyEngine.js";
import { createChildTraceContext, createRootTraceContext, TraceContext } from "./traceContext.js";

/**
 * Execution metadata collected during tool execution.
 */
export interface ExecutionMetadata {
  requestId: string;
  toolName: string;
  startTime: number;
  timeoutMs: number;
  parentRequestId?: string;
  /** Execution depth: 0 = top-level, incremented per nested call */
  depth: number;
  /** Policy tier of the executing tool */
  policyTier: PolicyTier;
  /** Parent policy tier for inheritance decisions */
  parentPolicyTier?: PolicyTier;
  /** Trace IDs for distributed correlation */
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

/**
 * Approval state carried through execution context.
 * Tools cannot mutate this — only the engine reads it.
 */
export interface ApprovalState {
  /** Whether this execution has been approved by policy+approval engine */
  isApproved: boolean;
  /** If denied, the denial reason */
  denialReason?: string;
}

/**
 * Execution context passed to every tool handler via ToolRegistry.
 */
export interface ToolExecutionContext {
  /** Unique request ID for end-to-end correlation */
  requestId: string;

  /** AbortSignal for cancellation — trigger via AbortController */
  signal: AbortSignal;

  /** Execution metadata */
  metadata: ExecutionMetadata;

  /** Approval state — set by policy engine, read by tools for awareness */
  approval: ApprovalState;
  /** Trace context for correlation and observability */
  trace: TraceContext;

  /**
   * Future: user/session identity
   * Future: provider info
   * Future: sandbox configuration
   */
}

/**
 * Throw if the AbortSignal has been triggered.
 * Tools should call this before FS operations, network calls,
 * loops, and process spawning for cooperative cancellation.
 *
 * @throws ToolExecutionErrorClass with CANCELLED code
 */
export function throwIfAborted(signal: AbortSignal, toolName?: string): void {
  if (signal.aborted) {
    throw new ToolExecutionErrorClass(
      ErrorCode.CANCELLED,
      `Operation was cancelled${toolName ? ` (tool: ${toolName})` : ""}`,
      { tool: toolName, retryable: false }
    );
  }
}

/**
 * Create a new execution context for a tool call.
 *
 * Context inheritance:
 * - Links child AbortController to parent's signal (cancellation propagates)
 * - Increments depth from parent
 * - Traces parentRequestId for end-to-end correlation
 * - Inherits parent policy tier for approval decisions
 *
 * @param toolName - The tool being executed
 * @param timeoutMs - Timeout in milliseconds
 * @param policyTier - Policy tier of this tool
 * @param parentRequestId - Optional parent request ID for chaining
 * @param parentDepth - Optional parent execution depth (defaults to 0)
 * @param parentSignal - Optional parent AbortSignal for cancellation linkage
 * @param parentPolicyTier - Optional parent policy tier for inheritance
 */
export function createExecutionContext(
  toolName: string,
  timeoutMs: number,
  policyTier: PolicyTier,
  parentRequestId?: string,
  parentDepth: number = 0,
  parentSignal?: AbortSignal,
  parentPolicyTier?: PolicyTier,
  parentTrace?: TraceContext
): { context: ToolExecutionContext; controller: AbortController } {
  const controller = new AbortController();
  const requestId = randomUUID();

  // Link child cancellation to parent: if parent aborts, child also aborts
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener(
        "abort",
        () => controller.abort(),
        { once: true }
      );
    }
  }

  const trace = parentTrace
    ? createChildTraceContext(parentTrace, { requestId, parentRequestId, toolName })
    : createRootTraceContext({ requestId, parentRequestId, toolName });

  const context: ToolExecutionContext = {
    requestId,
    signal: controller.signal,
    trace,
    metadata: {
      requestId,
      toolName,
      startTime: Date.now(),
      timeoutMs,
      parentRequestId,
      depth: parentDepth + 1,
      policyTier,
      parentPolicyTier,
      traceId: trace.traceId,
      spanId: trace.spanId,
      parentSpanId: trace.parentSpanId,
    },
    // Approval state starts as unapproved; policy engine sets it during execution
    approval: {
      isApproved: false,
    },
  };

  return { context, controller };
}
