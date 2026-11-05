/**
 * @deprecated ToolExecutor has been removed.
 * Use ToolRegistry.execute() as the single execution path.
 * All agent flows now route through ToolRegistry for consistent
 * schema validation, timeout, audit logging, and approval gating.
 *
 * See: src/core/toolRegistry.ts, src/engine/agentLoop.ts
 */
export {};
