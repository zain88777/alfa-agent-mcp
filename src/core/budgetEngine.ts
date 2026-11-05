/**
 * Budget engine — enforces execution budgets for tokens, cost, and tool calls.
 *
 * Budgets are scoped per plan/requestId chain. Each execution checks against
 * the running budget state and throws PLAN_LIMIT_EXCEEDED if breached.
 *
 * Budget state is transient (in-memory). No persistence.
 */

import { globalObservability, BudgetConfig, BudgetViolation } from "./observability.js";
import { ErrorCode, ToolExecutionErrorClass } from "./errorResponse.js";
import { globalAuditTrail } from "./auditTrail.js";

export class BudgetEngine {
  private budgets: Map<string, BudgetState> = new Map();

  private static budgetsByRequestId(requestId: string, parentRequestId?: string): string {
    return parentRequestId ? `${parentRequestId}:${requestId}` : `root:${requestId}`;
  }

  private getOrCreate(requestId: string, parentRequestId?: string): BudgetState {
    const key = BudgetEngine.budgetsByRequestId(requestId, parentRequestId);
    if (!this.budgets.has(key)) {
      this.budgets.set(key, new BudgetState());
    }
    return this.budgets.get(key)!;
  }

  applyBudget(budget: BudgetConfig, requestId: string, parentRequestId?: string): void {
    const state = this.getOrCreate(requestId, parentRequestId);
    if (budget.maxTokensPerExecution !== undefined) {
      state.maxTokens = budget.maxTokensPerExecution;
    }
    if (budget.maxCostUsdPerExecution !== undefined) {
      state.maxCostUsd = budget.maxCostUsdPerExecution;
    }
    if (budget.maxToolCallsPerExecution !== undefined) {
      state.maxToolCalls = budget.maxToolCallsPerExecution;
    }
    if (budget.maxProviderCallsPerExecution !== undefined) {
      state.maxProviderCalls = budget.maxProviderCallsPerExecution;
    }
    if (budget.maxCommandExecutionsPerExecution !== undefined) {
      state.maxCommandExecutions = budget.maxCommandExecutionsPerExecution;
    }
    if (budget.maxMutationOperationsPerExecution !== undefined) {
      state.maxMutationOperations = budget.maxMutationOperationsPerExecution;
    }
    if (budget.maxCacheEntries !== undefined) {
      state.maxCacheEntries = budget.maxCacheEntries;
    }
  }

  checkTokens(requestId: string, parentRequestId: string | undefined, tokens: number): void {
    const state = this.getOrCreate(requestId, parentRequestId);
    if (state.maxTokens !== undefined) {
      const total = state.usedTokens + tokens;
      globalAuditTrail.record("quota", "check", { type: "maxTokens", requestId, actual: total, limit: state.maxTokens });
      globalObservability.recordQuotaCheck({ type: "maxTokens", requestId, passed: total <= state.maxTokens, actual: total, limit: state.maxTokens, timestamp: Date.now() });
      if (total > state.maxTokens) {
        const violation: BudgetViolation = { type: "maxTokens", limit: state.maxTokens, actual: total, requestId };
        globalAuditTrail.record("quota", "violation", violation as unknown as Record<string, unknown>);
        globalObservability.recordBudgetViolation(violation);
        throw new ToolExecutionErrorClass(
          ErrorCode.PLAN_LIMIT_EXCEEDED,
          `Budget exceeded: token limit ${state.maxTokens} reached (${total} tokens)`,
          { tool: "budget", retryable: false, details: { budgetType: "maxTokens", limit: state.maxTokens, actual: total } }
        );
      }
      state.usedTokens = total;
    }
  }

  checkCost(requestId: string, parentRequestId: string | undefined, costUsd: number): void {
    const state = this.getOrCreate(requestId, parentRequestId);
    if (state.maxCostUsd !== undefined) {
      const total = state.usedCostUsd + costUsd;
      globalAuditTrail.record("quota", "check", { type: "maxCost", requestId, actual: total, limit: state.maxCostUsd });
      globalObservability.recordQuotaCheck({ type: "maxCost", requestId, passed: total <= state.maxCostUsd, actual: total, limit: state.maxCostUsd, timestamp: Date.now() });
      if (total > state.maxCostUsd) {
        const violation: BudgetViolation = { type: "maxCost", limit: state.maxCostUsd, actual: total, requestId };
        globalAuditTrail.record("quota", "violation", violation as unknown as Record<string, unknown>);
        globalObservability.recordBudgetViolation(violation);
        throw new ToolExecutionErrorClass(
          ErrorCode.PLAN_LIMIT_EXCEEDED,
          `Budget exceeded: cost limit $${state.maxCostUsd.toFixed(4)} reached ($${total.toFixed(4)})`,
          { tool: "budget", retryable: false, details: { budgetType: "maxCost", limit: state.maxCostUsd, actual: total } }
        );
      }
      state.usedCostUsd = total;
    }
  }

  countToolCall(requestId: string, parentRequestId: string | undefined): void {
    const state = this.getOrCreate(requestId, parentRequestId);
    state.toolCalls++;
    globalAuditTrail.record("quota", "check", { type: "maxToolCalls", requestId, actual: state.toolCalls, limit: state.maxToolCalls });
    globalObservability.recordQuotaCheck({ type: "maxToolCalls", requestId, passed: state.maxToolCalls === undefined || state.toolCalls <= state.maxToolCalls, actual: state.toolCalls, limit: state.maxToolCalls, timestamp: Date.now() });
    if (state.maxToolCalls !== undefined && state.toolCalls > state.maxToolCalls) {
      const violation: BudgetViolation = { type: "maxToolCalls", limit: state.maxToolCalls, actual: state.toolCalls, requestId };
      globalAuditTrail.record("quota", "violation", violation as unknown as Record<string, unknown>);
      globalObservability.recordBudgetViolation(violation);
      throw new ToolExecutionErrorClass(
        ErrorCode.PLAN_LIMIT_EXCEEDED,
        `Budget exceeded: tool call limit ${state.maxToolCalls} reached (${state.toolCalls} calls)`,
        { tool: "budget", retryable: false, details: { budgetType: "maxToolCalls", limit: state.maxToolCalls, actual: state.toolCalls } }
      );
    }
  }

  countProviderCall(requestId: string, parentRequestId: string | undefined, provider?: string): void {
    const state = this.getOrCreate(requestId, parentRequestId);
    state.providerCalls++;
    globalObservability.recordQuotaCheck({ type: "maxProviderCalls", requestId, provider, passed: state.maxProviderCalls === undefined || state.providerCalls <= state.maxProviderCalls, actual: state.providerCalls, limit: state.maxProviderCalls, timestamp: Date.now() });
    if (state.maxProviderCalls !== undefined && state.providerCalls > state.maxProviderCalls) {
      const violation: BudgetViolation = { type: "maxProviderCalls", limit: state.maxProviderCalls, actual: state.providerCalls, requestId, provider };
      globalObservability.recordBudgetViolation(violation);
      throw new ToolExecutionErrorClass(
        ErrorCode.PLAN_LIMIT_EXCEEDED,
        `Quota exceeded: provider call limit ${state.maxProviderCalls} reached (${state.providerCalls} calls)`,
        { tool: "budget", retryable: false, details: { budgetType: "maxProviderCalls", limit: state.maxProviderCalls, actual: state.providerCalls, provider } }
      );
    }
  }

  countCommandExecution(requestId: string, parentRequestId: string | undefined): void {
    const state = this.getOrCreate(requestId, parentRequestId);
    state.commandExecutions++;
    globalObservability.recordQuotaCheck({ type: "maxCommandExecutions", requestId, passed: state.maxCommandExecutions === undefined || state.commandExecutions <= state.maxCommandExecutions, actual: state.commandExecutions, limit: state.maxCommandExecutions, timestamp: Date.now() });
    if (state.maxCommandExecutions !== undefined && state.commandExecutions > state.maxCommandExecutions) {
      const violation: BudgetViolation = { type: "maxCommandExecutions", limit: state.maxCommandExecutions, actual: state.commandExecutions, requestId };
      globalObservability.recordBudgetViolation(violation);
      throw new ToolExecutionErrorClass(
        ErrorCode.PLAN_LIMIT_EXCEEDED,
        `Quota exceeded: command execution limit ${state.maxCommandExecutions} reached (${state.commandExecutions} calls)`,
        { tool: "budget", retryable: false, details: { budgetType: "maxCommandExecutions", limit: state.maxCommandExecutions, actual: state.commandExecutions } }
      );
    }
  }

  countMutationOperation(requestId: string, parentRequestId: string | undefined, toolName?: string): void {
    const state = this.getOrCreate(requestId, parentRequestId);
    state.mutationOperations++;
    globalObservability.recordQuotaCheck({ type: "maxMutationOperations", requestId, toolName, passed: state.maxMutationOperations === undefined || state.mutationOperations <= state.maxMutationOperations, actual: state.mutationOperations, limit: state.maxMutationOperations, timestamp: Date.now() });
    if (state.maxMutationOperations !== undefined && state.mutationOperations > state.maxMutationOperations) {
      const violation: BudgetViolation = { type: "maxMutationOperations", limit: state.maxMutationOperations, actual: state.mutationOperations, requestId, toolName };
      globalObservability.recordBudgetViolation(violation);
      throw new ToolExecutionErrorClass(
        ErrorCode.PLAN_LIMIT_EXCEEDED,
        `Quota exceeded: mutation operation limit ${state.maxMutationOperations} reached (${state.mutationOperations} ops)`,
        { tool: "budget", retryable: false, details: { budgetType: "maxMutationOperations", limit: state.maxMutationOperations, actual: state.mutationOperations, toolName } }
      );
    }
  }

  checkCacheEntries(requestId: string, parentRequestId: string | undefined, entries: number): void {
    const state = this.getOrCreate(requestId, parentRequestId);
    if (state.maxCacheEntries !== undefined) {
      globalObservability.recordQuotaCheck({ type: "maxCacheEntries", requestId, passed: entries <= state.maxCacheEntries, actual: entries, limit: state.maxCacheEntries, timestamp: Date.now() });
      if (entries > state.maxCacheEntries) {
        const violation: BudgetViolation = { type: "maxCacheEntries", limit: state.maxCacheEntries, actual: entries, requestId };
        globalObservability.recordBudgetViolation(violation);
        throw new ToolExecutionErrorClass(
          ErrorCode.PLAN_LIMIT_EXCEEDED,
          `Quota exceeded: cache entry limit ${state.maxCacheEntries} reached (${entries})`,
          { tool: "budget", retryable: false, details: { budgetType: "maxCacheEntries", limit: state.maxCacheEntries, actual: entries } }
        );
      }
    }
  }

  getState(requestId: string, parentRequestId?: string): { toolCalls: number; usedTokens: number; usedCostUsd: number; providerCalls: number; commandExecutions: number; mutationOperations: number; maxToolCalls?: number; maxTokens?: number; maxCostUsd?: number; maxProviderCalls?: number; maxCommandExecutions?: number; maxMutationOperations?: number; maxCacheEntries?: number } {
    const state = this.getOrCreate(requestId, parentRequestId);
    return { ...state };
  }

  reset(requestId: string, parentRequestId?: string): void {
    const key = BudgetEngine.budgetsByRequestId(requestId, parentRequestId);
    this.budgets.delete(key);
  }
}

class BudgetState {
  toolCalls = 0;
  usedTokens = 0;
  usedCostUsd = 0;
  providerCalls = 0;
  commandExecutions = 0;
  mutationOperations = 0;
  maxToolCalls?: number;
  maxTokens?: number;
  maxCostUsd?: number;
  maxProviderCalls?: number;
  maxCommandExecutions?: number;
  maxMutationOperations?: number;
  maxCacheEntries?: number;
}

export const globalBudgetEngine = new BudgetEngine();
