import { ToolRegistry } from "./toolRegistry.js";
import { PolicyEngine, createDefaultPolicyMap } from "./policyEngine.js";
import { ApprovalEngine } from "./approvalEngine.js";
import { persistRuntimeState } from "./runtimePersistence.js";
import { loadRuntimeConfig } from "./runtimeConfig.js";

import { agentChecklistToolHandler } from "../tools/agentChecklist.js";
import { agentExecuteToolHandler } from "../tools/agentExecute.js";
import { agentLoopToolHandler } from "../tools/agentLoop.js";
import { agentMemoryToolHandler } from "../tools/agentMemory.js";
import { agentPlanToolHandler } from "../tools/agentPlan.js";
import { agentRunToolHandler } from "../tools/agentRun.js";
import { appendLogToolHandler } from "../tools/appendLog.js";
import { applyPatchToolHandler, applyPatchSchema } from "../tools/applyPatch.js";
import { approvalQueueToolHandler } from "../tools/approvalQueue.js";
import { astImpactGraphToolHandler } from "../tools/astImpactGraph.js";
import { astPatchNodeToolHandler } from "../tools/astPatchNode.js";
import { astProjectFilesToolHandler } from "../tools/astProjectFiles.js";
import { autoAgentRunToolHandler } from "../tools/autoAgentRun.js";
import { autoCommitToolHandler } from "../tools/autoCommit.js";
import { autoDebugToolHandler } from "../tools/autoDebug.js";
import { autoDebugLoopToolHandler } from "../tools/autoDebugLoop.js";
import { autoFixToolHandler } from "../tools/autoFix.js";
import { autoOrchestratorToolHandler } from "../tools/autoOrchestrator.js";
import { autoPipelineToolHandler } from "../tools/autoPipeline.js";
import { autoRecoverToolHandler } from "../tools/autoRecover.js";
import { codeMapToolHandler } from "../tools/codeMap.js";
import { codeQualityScoreToolHandler } from "../tools/codeQualityScore.js";
import { codeRewriteToolHandler } from "../tools/codeRewrite.js";
import { copyFileToolHandler, copyFileSchema } from "../tools/copyFile.js";
import { createDirectoryToolHandler, createDirectorySchema } from "../tools/createDirectory.js";
import { deadExportScanToolHandler } from "../tools/deadExportScan.js";
import { decisionEngineToolHandler } from "../tools/decisionEngine.js";
import { deleteFileToolHandler, deleteFileSchema } from "../tools/deleteFile.js";
import { dependencyScanToolHandler } from "../tools/dependencyScan.js";
import { diagnoseTypeScriptToolHandler } from "../tools/diagnoseTypeScript.js";
import { diffReviewToolHandler } from "../tools/diffReview.js";
import { duplicateFilesToolHandler } from "../tools/duplicateFiles.js";
import { envScanToolHandler } from "../tools/envScan.js";
import { errorExplainToolHandler } from "../tools/errorExplain.js";
import { fileStatsToolHandler } from "../tools/fileStats.js";
import { finalExecutorToolHandler } from "../tools/finalExecutor.js";
import { gitCheckpointToolHandler } from "../tools/gitCheckpoint.js";
import { gitDiffToolHandler } from "../tools/gitDiff.js";
import { gitRevertLastToolHandler } from "../tools/gitRevertLast.js";
import { gitStatusToolHandler } from "../tools/gitStatus.js";
import { goalWorkflowToolHandler } from "../tools/goalWorkflow.js";
import { grepTextToolHandler, grepTextSchema } from "../tools/grepText.js";
import { impactAnalysisToolHandler } from "../tools/impactAnalysis.js";
import { importGraphToolHandler } from "../tools/importGraph.js";
import { intelligentRunToolHandler } from "../tools/intelligentRun.js";
import { listFilesToolHandler, listFilesSchema } from "../tools/listFiles.js";
import { llmAgentRunToolHandler } from "../tools/llmAgentRun.js";
import { moveFileToolHandler, moveFileSchema } from "../tools/moveFile.js";
import { multiAgentRunToolHandler } from "../tools/multiAgentRun.js";
import { npmTestToolHandler } from "../tools/npmTest.js";
import { packageScriptsToolHandler } from "../tools/packageScripts.js";
import { parallelRunToolHandler } from "../tools/parallelRun.js";
import { planExecuteToolHandler } from "../tools/planExecute.js";
import { planSessionToolHandler, planSessionSchema } from "../tools/planSession.js";
import { executionPreviewToolHandler, executionPreviewSchema } from "../tools/executionPreview.js";
import { metricsSnapshotToolHandler, metricsSnapshotSchema } from "../tools/metricsSnapshot.js";
import { runtimeSnapshotToolHandler, runtimeSnapshotSchema } from "../tools/runtimeSnapshot.js";
import { runtimeRecoveryToolHandler, runtimeRecoverySchema } from "../tools/runtimeRecovery.js";
import { sessionCoordinationToolHandler, sessionCoordinationSchema } from "../tools/sessionCoordination.js";
import { checkpointExportToolHandler, checkpointExportSchema } from "../tools/checkpointExport.js";
import { checkpointImportToolHandler, checkpointImportSchema } from "../tools/checkpointImport.js";
import { auditExportToolHandler, auditExportSchema } from "../tools/auditExport.js";
import { auditVerifyToolHandler, auditVerifySchema } from "../tools/auditVerify.js";
import { replaySimulateToolHandler, replaySimulateSchema } from "../tools/replaySimulate.js";
import { powershellHistoryToolHandler } from "../tools/powershellHistory.js";
import { powershellLastToolHandler } from "../tools/powershellLast.js";
import { powershellRunToolHandler } from "../tools/powershellRun.js";
import { projectInfoToolHandler } from "../tools/projectInfo.js";
import { projectSummaryToolHandler } from "../tools/projectSummary.js";
import { projectTreeToolHandler } from "../tools/projectTree.js";
import { readAgentInstructionsToolHandler } from "../tools/readAgentInstructions.js";
import { readFileToolHandler, readFileSchema } from "../tools/readFile.js";
import { readJsonToolHandler, readJsonSchema } from "../tools/readJson.js";
import { readLinesToolHandler } from "../tools/readLines.js";
import { readLogToolHandler } from "../tools/readLog.js";
import { recentFilesToolHandler } from "../tools/recentFiles.js";
import { registryHealthCheckToolHandler } from "../tools/registryHealthCheck.js";
import { replaceTextToolHandler, replaceTextSchema } from "../tools/replaceText.js";
import { restoreBackupFileToolHandler, restoreBackupFileSchema } from "../tools/restoreBackupFile.js";
import { routeScanToolHandler } from "../tools/routeScan.js";
import { runCommandToolHandler, runCommandSchema } from "../tools/runCommand.js";
import { safeBackupFileToolHandler, safeBackupFileSchema } from "../tools/safeBackupFile.js";
import { searchFilesToolHandler, searchFilesSchema } from "../tools/searchFiles.js";
import { securityScanToolHandler } from "../tools/securityScan.js";
import { selfAuditToolHandler } from "../tools/selfAudit.js";
import { selfImproveToolHandler } from "../tools/selfImprove.js";
import {
  screenClickSchema,
  screenClickToolHandler,
  screenDoubleClickSchema,
  screenDoubleClickToolHandler,
  screenKeySchema,
  screenKeyToolHandler,
  screenMoveSchema,
  screenMoveToolHandler,
  screenObserveSchema,
  screenObserveToolHandler,
  screenScrollSchema,
  screenScrollToolHandler,
  screenStartSchema,
  screenStartToolHandler,
  screenStatusSchema,
  screenStatusToolHandler,
  screenStopSchema,
  screenStopToolHandler,
  screenTypeSchema,
  screenTypeToolHandler,
  screenWaitSchema,
  screenWaitToolHandler,
} from "../tools/screenAgent.js";
import { smartAgentRunToolHandler } from "../tools/smartAgentRun.js";
import { smartRefactorToolHandler } from "../tools/smartRefactor.js";
import { statusTitleToolHandler } from "../tools/statusTitle.js";
import { taskRunnerToolHandler } from "../tools/taskRunner.js";
import { terminalHistoryToolHandler } from "../tools/terminalHistory.js";
import { todoScanToolHandler } from "../tools/todoScan.js";
import { tsSymbolIndexToolHandler } from "../tools/tsSymbolIndex.js";
import { typecheckToolHandler } from "../tools/typecheck.js";
import { unifiedPatchToolHandler } from "../tools/unifiedPatch.js";
import { workspaceConfigToolHandler } from "../tools/workspaceConfig.js";
import { worktreeListToolHandler } from "../tools/worktreeList.js";
import { writeFileToolHandler, writeFileSchema } from "../tools/writeFile.js";
import { writeJsonToolHandler, writeJsonSchema } from "../tools/writeJson.js";

// Browser DevTools Bridge tools
import { browserStatusToolHandler, browserStatusSchema } from "../tools/browserStatus.js";
import { browserTabsToolHandler, browserTabsSchema } from "../tools/browserTabs.js";
import { browserObserveToolHandler, browserObserveSchema } from "../tools/browserObserve.js";
import { browserDomSnapshotToolHandler, browserDomSnapshotSchema } from "../tools/browserDomSnapshot.js";
import { browserConsoleLogsToolHandler, browserConsoleLogsSchema } from "../tools/browserConsoleLogs.js";
import { browserNetworkLogsToolHandler, browserNetworkLogsSchema } from "../tools/browserNetworkLogs.js";
import { browserInspectElementToolHandler, browserInspectElementSchema } from "../tools/browserInspectElement.js";
import { browserClickToolHandler, browserClickSchema } from "../tools/browserClick.js";
import { browserTypeToolHandler, browserTypeSchema } from "../tools/browserType.js";
import { browserScrollToolHandler, browserScrollSchema } from "../tools/browserScroll.js";
import { browserEvalSafeToolHandler, browserEvalSafeSchema } from "../tools/browserEvalSafe.js";
import { browserScreenshotToolHandler, browserScreenshotSchema } from "../tools/browserScreenshot.js";

let _registry: ToolRegistry | null = null;

/**
 * Create a fully initialized ToolRegistry with policy and approval engines.
 * All tools are registered and classified by policy tier.
 */
export function createRegistry(): ToolRegistry {
  const runtimeConfig = loadRuntimeConfig();
  // Create policy engine with default tool classification
  const policyMap = createDefaultPolicyMap();
  const policyEngine = new PolicyEngine(policyMap, {
    allowDangerousTools: runtimeConfig.mcp.allowDangerousTools,
  });
  const approvalEngine = new ApprovalEngine();

  const registry = new ToolRegistry(policyEngine, approvalEngine);
  approvalEngine.setOnChange(() => persistRuntimeState(registry));
  console.error(`[AlfaDev][Startup] created ${registry.instanceId} with shared approval engine`);

  // Register all tools
  registry.register("agent_checklist", agentChecklistToolHandler);
  registry.register("agent_execute", agentExecuteToolHandler);
  registry.register("agent_loop", agentLoopToolHandler);
  registry.register("agent_memory", agentMemoryToolHandler);
  registry.register("agent_plan", agentPlanToolHandler);
  registry.register("agent_run", (input: unknown) =>
    agentRunToolHandler({
      ...((typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>),
      registry,
    } as { goal: string; registry: ToolRegistry })
  );
  registry.register("append_log", appendLogToolHandler);
  registry.register("apply_patch", applyPatchToolHandler, applyPatchSchema, "Apply a text patch to a file");
  registry.register("approval_queue", (input: unknown) =>
    approvalQueueToolHandler((input as { action: "add" | "list" | "clear"; title?: string; command?: string; reason?: string }), approvalEngine));
  registry.register("ast_impact_graph", astImpactGraphToolHandler);
  registry.register("ast_patch_node", astPatchNodeToolHandler);
  registry.register("ast_project_files", astProjectFilesToolHandler);
  registry.register("auto_agent_run", autoAgentRunToolHandler);
  registry.register("auto_commit", autoCommitToolHandler);
  registry.register("auto_debug", autoDebugToolHandler);
  registry.register("auto_debug_loop", autoDebugLoopToolHandler);
  registry.register("auto_fix", autoFixToolHandler);
  registry.register("auto_orchestrator", autoOrchestratorToolHandler);
  registry.register("auto_pipeline", autoPipelineToolHandler);
  registry.register("auto_recover", autoRecoverToolHandler);
  registry.register("code_map", codeMapToolHandler);
  registry.register("code_quality_score", codeQualityScoreToolHandler);
  registry.register("code_rewrite", codeRewriteToolHandler);
  registry.register("copy_file", copyFileToolHandler, copyFileSchema, "Copy a file from source to destination");
  registry.register("create_directory", createDirectoryToolHandler, createDirectorySchema, "Create a new directory");
  registry.register("dead_export_scan", deadExportScanToolHandler);
  registry.register("decision_engine", decisionEngineToolHandler);
  registry.register("delete_file", deleteFileToolHandler, deleteFileSchema, "Delete a file (dangerous)");
  registry.register("dependency_scan", dependencyScanToolHandler);
  registry.register("diagnose_type_script", diagnoseTypeScriptToolHandler);
  registry.register("diff_review", diffReviewToolHandler);
  registry.register("duplicate_files", duplicateFilesToolHandler);
  registry.register("env_scan", envScanToolHandler);
  registry.register("error_explain", errorExplainToolHandler);
  registry.register("file_stats", fileStatsToolHandler);
  registry.register("final_executor", finalExecutorToolHandler);
  registry.register("git_checkpoint", gitCheckpointToolHandler);
  registry.register("git_diff", gitDiffToolHandler);
  registry.register("git_revert_last", gitRevertLastToolHandler);
  registry.register("git_status", gitStatusToolHandler);
  registry.register("goal_workflow", goalWorkflowToolHandler);
  registry.register("grep_text", grepTextToolHandler, grepTextSchema, "Search file contents for text matches");
  registry.register("impact_analysis", impactAnalysisToolHandler);
  registry.register("import_graph", importGraphToolHandler);
  registry.register("intelligent_run", intelligentRunToolHandler);
  registry.register("list_files", listFilesToolHandler, listFilesSchema, "List files in a directory");
  registry.register("llm_agent_run", llmAgentRunToolHandler);
  registry.register("move_file", moveFileToolHandler, moveFileSchema, "Move or rename a file");
  registry.register("multi_agent_run", multiAgentRunToolHandler);
  registry.register("npm_test", npmTestToolHandler);
  registry.register("package_scripts", packageScriptsToolHandler);
  registry.register("parallel_run", parallelRunToolHandler);
  registry.register("plan_execute", planExecuteToolHandler);
  registry.register("plan_session", planSessionToolHandler, planSessionSchema, "Transaction session for staged mutation plans with preview/commit/rollback");
  registry.register("execution_preview", executionPreviewToolHandler, executionPreviewSchema, "Preview mutations as a dry-run aggregation before committing a transaction session");
  registry.register("metrics_snapshot", metricsSnapshotToolHandler, metricsSnapshotSchema, "Structured observability snapshot: cost, latency percentiles, budgets, timelines");
  registry.register("runtime_snapshot", (input: unknown) =>
    runtimeSnapshotToolHandler(input, registry), runtimeSnapshotSchema, "Redacted runtime state snapshot for inspection and recovery-readiness");
  registry.register("runtime_recovery", (input: unknown) =>
    runtimeRecoveryToolHandler((input as { action?: "report" | "inspect" | "mark_stale_failed" | "rollback_if_eligible"; sessionId?: string }) ?? {}, registry), runtimeRecoverySchema, "Recovery report and safe recovery actions");
  registry.register("session_coordination", sessionCoordinationToolHandler, sessionCoordinationSchema, "Runtime session identity and mutation-lock coordination report");
  registry.register("checkpoint_export", (input: unknown) =>
    checkpointExportToolHandler((input as { path?: string }) ?? {}, registry), checkpointExportSchema, "Export safe runtime checkpoint JSON");
  registry.register("checkpoint_import", (input: unknown) =>
    checkpointImportToolHandler((input as { path?: string }) ?? {}, registry), checkpointImportSchema, "Import and validate safe runtime checkpoint JSON");
  registry.register("audit_export", auditExportToolHandler, auditExportSchema, "Export signed audit log to workspace file");
  registry.register("audit_verify", auditVerifyToolHandler, auditVerifySchema, "Verify audit log checksum and hash chain");
  registry.register("replay_simulate", replaySimulateToolHandler, replaySimulateSchema, "Deterministic replay simulation from in-memory or exported audit log");
  registry.register("powershell_history", powershellHistoryToolHandler);
  registry.register("powershell_last", powershellLastToolHandler);
  registry.register("powershell_run", powershellRunToolHandler);
  registry.register("project_info", projectInfoToolHandler);
  registry.register("project_summary", projectSummaryToolHandler);
  registry.register("project_tree", projectTreeToolHandler);
  registry.register("read_agent_instructions", readAgentInstructionsToolHandler);
  registry.register("read_file", readFileToolHandler, readFileSchema, "Read a file's contents");
  registry.register("read_json", readJsonToolHandler, readJsonSchema, "Read and parse a JSON file");
  registry.register("read_lines", readLinesToolHandler);
  registry.register("read_log", readLogToolHandler);
  registry.register("recent_files", recentFilesToolHandler);
  registry.register("registry_health_check", () =>
    registryHealthCheckToolHandler({ registry })
  );
  registry.register("replace_text", replaceTextToolHandler, replaceTextSchema, "Replace text in a file");
  registry.register("restore_backup_file", restoreBackupFileToolHandler, restoreBackupFileSchema, "Restore a file from backup");
  registry.register("route_scan", routeScanToolHandler);
  registry.register("run_command", runCommandToolHandler, runCommandSchema, "Execute a predefined command (safer via commandId)");
  registry.register("safe_backup_file", safeBackupFileToolHandler, safeBackupFileSchema, "Create a safe backup of a file");
  registry.register("search_files", searchFilesToolHandler, searchFilesSchema, "Search for files by name pattern");
  registry.register("security_scan", securityScanToolHandler);
  registry.register("self_audit", selfAuditToolHandler);
  registry.register("self_improve", selfImproveToolHandler);
  registry.register("screen_start", screenStartToolHandler, screenStartSchema, "Start local AI screen control session with local approval");
  registry.register("screen_observe", screenObserveToolHandler, screenObserveSchema, "Capture current desktop screenshot and metadata");
  registry.register("screen_move", screenMoveToolHandler, screenMoveSchema, "Move mouse cursor to desktop coordinates without clicking");
  registry.register("screen_click", screenClickToolHandler, screenClickSchema, "Click at desktop coordinates");
  registry.register("screen_double_click", screenDoubleClickToolHandler, screenDoubleClickSchema, "Double-click at desktop coordinates");
  registry.register("screen_type", screenTypeToolHandler, screenTypeSchema, "Type text into active desktop control");
  registry.register("screen_key", screenKeyToolHandler, screenKeySchema, "Send key press with optional modifiers");
  registry.register("screen_scroll", screenScrollToolHandler, screenScrollSchema, "Scroll mouse wheel");
  registry.register("screen_wait", screenWaitToolHandler, screenWaitSchema, "Wait for a number of milliseconds");
  registry.register("screen_stop", screenStopToolHandler, screenStopSchema, "Emergency stop and latch screen control");
  registry.register("screen_status", screenStatusToolHandler, screenStatusSchema, "Get screen agent status");

  // Browser DevTools Bridge tools
  registry.register("browser_status", browserStatusToolHandler, browserStatusSchema, "Get browser bridge connection status");
  registry.register("browser_tabs", browserTabsToolHandler, browserTabsSchema, "List open browser tabs");
  registry.register("browser_observe", browserObserveToolHandler, browserObserveSchema, "Observe current browser tab metadata");
  registry.register("browser_dom_snapshot", browserDomSnapshotToolHandler, browserDomSnapshotSchema, "Capture DOM tree snapshot from browser");
  registry.register("browser_console_logs", browserConsoleLogsToolHandler, browserConsoleLogsSchema, "Get browser console logs");
  registry.register("browser_network_logs", browserNetworkLogsToolHandler, browserNetworkLogsSchema, "Get browser network request logs");
  registry.register("browser_inspect_element", browserInspectElementToolHandler, browserInspectElementSchema, "Inspect element computed styles and dimensions");
  registry.register("browser_click", browserClickToolHandler, browserClickSchema, "Click element in browser (requires approval)");
  registry.register("browser_type", browserTypeToolHandler, browserTypeSchema, "Type text into browser element (requires approval)");
  registry.register("browser_scroll", browserScrollToolHandler, browserScrollSchema, "Scroll browser page or element");
  registry.register("browser_eval_safe", browserEvalSafeToolHandler, browserEvalSafeSchema, "Execute read-only safe JS in browser tab");
  registry.register("browser_screenshot", browserScreenshotToolHandler, browserScreenshotSchema, "Capture browser screenshot");

  registry.register("smart_agent_run", smartAgentRunToolHandler);
  registry.register("smart_refactor", smartRefactorToolHandler);
  registry.register("status_title", statusTitleToolHandler);
  registry.register("task_runner", taskRunnerToolHandler);
  registry.register("terminal_history", terminalHistoryToolHandler);
  registry.register("todo_scan", todoScanToolHandler);
  registry.register("ts_symbol_index", tsSymbolIndexToolHandler);
  registry.register("typecheck", typecheckToolHandler);
  registry.register("unified_patch", unifiedPatchToolHandler);
  registry.register("workspace_config", workspaceConfigToolHandler);
  registry.register("worktree_list", worktreeListToolHandler);
  registry.register("write_file", writeFileToolHandler, writeFileSchema, "Write content to a file");
  registry.register("write_json", writeJsonToolHandler, writeJsonSchema, "Write JSON data to a file");

  return registry;
}

/**
 * Get or create the global registry singleton.
 */
export function getRegistry(): ToolRegistry {
  if (!_registry) {
    _registry = createRegistry();
  }
  return _registry;
}

/**
 * Load tools into an existing registry (previously used for external registries).
 * Now internal — call getRegistry() instead.
 */
export function loadTools(registry: ToolRegistry) {
  const fresh = createRegistry();
  // Use importFromRegistry which accesses private state internally
  registry.importFromRegistry(fresh);
}
