/**
 * Structured tool execution logging — append-only, immutable entries.
 *
 * AUDIT INTEGRITY:
 * - Logs are never mutated after append (no `updatedLog` replacement).
 * - Each execution lifecycle: addLog(start) → endExecution creates a NEW entry.
 * - startExecution returns a `logTicket` (start timestamp) for correlation, not a mutable reference.
 * - Tools cannot mutate execution IDs, timestamps, or policy decisions.
 * - `startExecution` and `endExecution` are separate writes — no in-place mutation.
 */

import { randomUUID } from "crypto";

export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

export interface ToolExecutionLog {
  /** Unique log entry ID (immutable after creation) */
  id: string;
  timestamp: string;
  toolName: string;
  logLevel: LogLevel;
  startTime: number;
  duration?: number;
  success?: boolean;
  errorMessage?: string;
  errorCode?: string;
  inputSize?: number;
  outputSize?: number;
  /** Correlation ID for end-to-end tracing (from execution context) */
  requestId?: string;
  /** Parent request ID for chained executions */
  parentRequestId?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  provider?: string;
  model?: string;
}

/**
 * Lightweight ticket returned by startExecution.
 * Used only to correlate start → end in endExecution.
 * Never exposes the mutable log entry.
 */
export interface ExecutionTicket {
  startTime: number;
  toolName: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
}

export class ToolLogger {
  private logs: ToolExecutionLog[] = [];
  private maxLogs: number = 10000;

  /**
   * Log tool execution start — creates an immutable log entry immediately.
   * Returns a ticket for endExecution correlation.
   * The start entry remains in the log regardless of completion.
   */
  startExecution(
    toolName: string,
    inputSize?: number,
    requestId?: string,
    parentRequestId?: string,
    trace?: { traceId?: string; spanId?: string; parentSpanId?: string; provider?: string; model?: string }
  ): ExecutionTicket {
    const log: ToolExecutionLog = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      toolName,
      logLevel: LogLevel.INFO,
      startTime: Date.now(),
      inputSize,
      requestId,
      parentRequestId,
      traceId: trace?.traceId,
      spanId: trace?.spanId,
      parentSpanId: trace?.parentSpanId,
      provider: trace?.provider,
      model: trace?.model,
      // success, duration, error fields intentionally undefined at start
    };

    this.addLog(log);
    return { startTime: log.startTime, toolName: log.toolName, traceId: trace?.traceId, spanId: trace?.spanId, parentSpanId: trace?.parentSpanId };
  }

  /**
   * Log tool execution completion — creates a SECOND immutable entry.
   * Does NOT mutate the start entry. The complete lifecycle is two entries.
   */
  endExecution(
    ticket: ExecutionTicket,
    success: boolean,
    outputSize?: number,
    errorMessage?: string,
    errorCode?: string,
    requestId?: string,
    parentRequestId?: string,
    trace?: { traceId?: string; spanId?: string; parentSpanId?: string; provider?: string; model?: string }
  ): ToolExecutionLog {
    const log: ToolExecutionLog = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      toolName: ticket.toolName,
      logLevel: success ? LogLevel.INFO : LogLevel.ERROR,
      startTime: ticket.startTime,
      duration: Date.now() - ticket.startTime,
      success,
      outputSize,
      errorMessage,
      errorCode,
      requestId,
      parentRequestId,
      traceId: trace?.traceId ?? ticket.traceId,
      spanId: trace?.spanId ?? ticket.spanId,
      parentSpanId: trace?.parentSpanId ?? ticket.parentSpanId,
      provider: trace?.provider,
      model: trace?.model,
    };

    this.addLog(log);
    return log;
  }

  /**
   * Add log entry (append-only).
   */
  private addLog(log: ToolExecutionLog): void {
    this.logs.push(log);

    // Prune old logs if exceeding max
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(this.logs.length - this.maxLogs);
    }
  }

  /**
   * Get all logs (returns a copy — never exposes the internal array).
   */
  getLogs(): ToolExecutionLog[] {
    return [...this.logs];
  }

  /**
   * Get logs for specific tool
   */
  getToolLogs(toolName: string): ToolExecutionLog[] {
    return this.logs.filter(log => log.toolName === toolName);
  }

  /**
   * Get logs filtered by success status
   */
  getLogsByStatus(success?: boolean): ToolExecutionLog[] {
    if (success === undefined) return this.getLogs();
    return this.logs.filter(log => log.success === success);
  }

  /**
   * Get execution statistics
   */
  getStats(): {
    totalExecutions: number;
    successCount: number;
    errorCount: number;
    averageDuration: number;
    toolStats: Record<string, { count: number; success: number; avgDuration: number }>;
  } {
    const completed = this.logs.filter(l => l.success !== undefined && l.duration !== undefined);
    const totalExecutions = completed.length;
    const successCount = completed.filter(l => l.success).length;
    const errorCount = completed.filter(l => !l.success).length;

    const totalDuration = completed.reduce((sum, l) => sum + (l.duration || 0), 0);
    const averageDuration = totalExecutions > 0 ? totalDuration / totalExecutions : 0;

    const toolStats: Record<string, { count: number; success: number; avgDuration: number }> = {};

    for (const log of completed) {
      if (!toolStats[log.toolName]) {
        toolStats[log.toolName] = { count: 0, success: 0, avgDuration: 0 };
      }
      toolStats[log.toolName].count++;
      if (log.success) toolStats[log.toolName].success++;
      toolStats[log.toolName].avgDuration += log.duration || 0;
    }

    for (const key in toolStats) {
      if (toolStats[key].count > 0) {
        toolStats[key].avgDuration /= toolStats[key].count;
      }
    }

    return {
      totalExecutions,
      successCount,
      errorCount,
      averageDuration,
      toolStats,
    };
  }

  /**
   * Clear logs
   */
  clear(): void {
    this.logs = [];
  }

  /**
   * Format log entry for display
   */
  static formatLog(log: ToolExecutionLog): string {
    const duration = log.duration !== undefined ? `${log.duration}ms` : "pending";
    const status = log.success === true ? "✓" : log.success === false ? "✗" : "…";
    const error = log.errorMessage ? ` - ${log.errorMessage}` : "";
    const rid = log.requestId ? ` [${log.requestId.slice(0, 8)}]` : "";
    return `[${log.timestamp}]${rid} ${status} ${log.toolName} (${duration})${error}`;
  }
}

// Global logger instance
export const globalToolLogger = new ToolLogger();
