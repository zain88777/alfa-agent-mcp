import { randomUUID } from "crypto";

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  requestId: string;
  parentRequestId?: string;
  toolName?: string;
  provider?: string;
  model?: string;
}

export function createRootTraceContext(input?: Partial<TraceContext>): TraceContext {
  return {
    traceId: input?.traceId ?? randomUUID(),
    spanId: input?.spanId ?? randomUUID(),
    requestId: input?.requestId ?? randomUUID(),
    parentRequestId: input?.parentRequestId,
    toolName: input?.toolName,
    provider: input?.provider,
    model: input?.model,
  };
}

export function createChildTraceContext(parent: TraceContext, input?: Partial<TraceContext>): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: input?.spanId ?? randomUUID(),
    parentSpanId: parent.spanId,
    requestId: input?.requestId ?? parent.requestId,
    parentRequestId: input?.parentRequestId ?? parent.parentRequestId,
    toolName: input?.toolName,
    provider: input?.provider,
    model: input?.model,
  };
}
