export enum PolicyTier {
  READ_ONLY = "read_only",
  SAFE_WRITE = "safe_write",
  DANGEROUS = "dangerous",
  SYSTEM_SENSITIVE = "system_sensitive",
}

export interface ToolPolicyConfig {
  tier: PolicyTier;
  defaultAllow?: boolean;
  requiresApproval?: boolean;
}

export interface PolicyDecision {
  allowed: boolean;
  tier: PolicyTier;
  requiresApproval: boolean;
  denialReason?: string;
}

export interface PolicyEngineOptions {
  allowDangerousTools?: boolean;
}

const TIER_ORDER = [
  PolicyTier.READ_ONLY,
  PolicyTier.SAFE_WRITE,
  PolicyTier.DANGEROUS,
  PolicyTier.SYSTEM_SENSITIVE,
];

const TIER_DEFAULTS: Record<PolicyTier, Required<Omit<ToolPolicyConfig, "tier">>> = {
  [PolicyTier.READ_ONLY]: { defaultAllow: true, requiresApproval: false },
  [PolicyTier.SAFE_WRITE]: { defaultAllow: true, requiresApproval: false },
  [PolicyTier.DANGEROUS]: { defaultAllow: false, requiresApproval: true },
  [PolicyTier.SYSTEM_SENSITIVE]: { defaultAllow: false, requiresApproval: true },
};

function tierIndex(tier: PolicyTier): number {
  return TIER_ORDER.indexOf(tier);
}

export class PolicyEngine {
  private readonly policyMap: Map<string, ToolPolicyConfig>;
  private readonly options: PolicyEngineOptions;

  constructor(policyMap?: Map<string, ToolPolicyConfig>, options: PolicyEngineOptions = {}) {
    this.policyMap = policyMap ?? new Map();
    this.options = options;
  }

  getPolicy(toolName: string): ToolPolicyConfig | undefined {
    return this.policyMap.get(toolName);
  }

  evaluate(toolName: string, specificApprovalExists = false): PolicyDecision {
    const config = this.policyMap.get(toolName);
    if (!config) {
      return {
        allowed: false,
        tier: PolicyTier.DANGEROUS,
        requiresApproval: true,
        denialReason: `Tool '${toolName}' is not classified in policy - default deny. Register a policy tier for this tool.`,
      };
    }

    const tierDefaults = TIER_DEFAULTS[config.tier];
    if (!tierDefaults) {
      return {
        allowed: false,
        tier: config.tier,
        requiresApproval: true,
        denialReason: `Tool '${toolName}' has unrecognized policy tier '${config.tier}' - denied.`,
      };
    }

    if (this.options.allowDangerousTools && config.tier === PolicyTier.DANGEROUS) {
      return { allowed: true, tier: config.tier, requiresApproval: false };
    }

    const defaultAllow = config.defaultAllow ?? tierDefaults.defaultAllow;
    const requiresApproval = config.requiresApproval ?? tierDefaults.requiresApproval;

    if (requiresApproval) {
      if (specificApprovalExists) {
        return { allowed: true, tier: config.tier, requiresApproval: true };
      }
      return {
        allowed: false,
        tier: config.tier,
        requiresApproval: true,
        denialReason: `Tool '${toolName}' requires approval for policy tier '${config.tier}' - denied. Submit an approval request first.`,
      };
    }

    if (defaultAllow) {
      return { allowed: true, tier: config.tier, requiresApproval: false };
    }

    return {
      allowed: false,
      tier: config.tier,
      requiresApproval: false,
      denialReason: `Tool '${toolName}' (tier: '${config.tier}') is not permitted by default policy.`,
    };
  }

  isMoreSensitive(tier: PolicyTier, than: PolicyTier): boolean {
    return tierIndex(tier) > tierIndex(than);
  }

  doesTierCover(approvalTier: PolicyTier, requestedTier: PolicyTier): boolean {
    return tierIndex(approvalTier) >= tierIndex(requestedTier);
  }

  listPolicies(): Array<{ toolName: string; policy: ToolPolicyConfig }> {
    return Array.from(this.policyMap.entries()).map(([toolName, policy]) => ({
      toolName,
      policy,
    }));
  }
}

export function createDefaultPolicyMap(): Map<string, ToolPolicyConfig> {
  const map = new Map<string, ToolPolicyConfig>();

  const readOnly = [
    "agent_checklist",
    "agent_memory",
    "append_log",
    "approval_queue",
    "ast_impact_graph",
    "ast_project_files",
    "audit_verify",
    "browser_console_logs",
    "browser_dom_snapshot",
    "browser_eval_safe",
    "browser_inspect_element",
    "browser_network_logs",
    "browser_observe",
    "browser_screenshot",
    "browser_scroll",
    "browser_status",
    "browser_tabs",
    "checkpoint_export",
    "code_map",
    "code_quality_score",
    "dead_export_scan",
    "dependency_scan",
    "diagnose_type_script",
    "diff_review",
    "duplicate_files",
    "error_explain",
    "execution_preview",
    "file_stats",
    "grep_text",
    "import_graph",
    "list_files",
    "metrics_snapshot",
    "package_scripts",
    "powershell_history",
    "powershell_last",
    "project_info",
    "project_summary",
    "project_tree",
    "read_agent_instructions",
    "read_file",
    "read_json",
    "read_lines",
    "read_log",
    "recent_files",
    "registry_health_check",
    "route_scan",
    "runtime_snapshot",
    "search_files",
    "session_coordination",
    "todo_scan",
    "ts_symbol_index",
    "typecheck",
    "workspace_config",
    "worktree_list",
  ];

  const safeWrite = [
    "agent_plan",
    "apply_patch",
    "audit_export",
    "checkpoint_import",
    "copy_file",
    "create_directory",
    "move_file",
    "plan_session",
    "replace_text",
    "restore_backup_file",
    "safe_backup_file",
    "write_file",
    "write_json",
  ];

  const dangerous = [
    "agent_execute",
    "agent_loop",
    "agent_run",
    "ast_patch_node",
    "auto_agent_run",
    "auto_commit",
    "auto_debug",
    "auto_debug_loop",
    "auto_fix",
    "auto_orchestrator",
    "auto_pipeline",
    "auto_recover",
    "browser_click",
    "browser_type",
    "code_rewrite",
    "decision_engine",
    "delete_file",
    "final_executor",
    "git_checkpoint",
    "git_diff",
    "git_revert_last",
    "git_status",
    "goal_workflow",
    "impact_analysis",
    "intelligent_run",
    "llm_agent_run",
    "multi_agent_run",
    "npm_test",
    "parallel_run",
    "plan_execute",
    "powershell_run",
    "replay_simulate",
    "run_command",
    "runtime_recovery",
    "screen_click",
    "screen_double_click",
    "screen_key",
    "screen_move",
    "screen_observe",
    "screen_scroll",
    "screen_start",
    "screen_stop",
    "screen_type",
    "screen_wait",
    "smart_agent_run",
    "smart_refactor",
    "task_runner",
    "terminal_history",
    "unified_patch",
  ];

  const systemSensitive = [
    "env_scan",
    "security_scan",
    "self_audit",
    "self_improve",
    "status_title",
  ];

  for (const name of readOnly) map.set(name, { tier: PolicyTier.READ_ONLY });
  for (const name of safeWrite) map.set(name, { tier: PolicyTier.SAFE_WRITE });
  for (const name of dangerous) map.set(name, { tier: PolicyTier.DANGEROUS });
  for (const name of systemSensitive) map.set(name, { tier: PolicyTier.SYSTEM_SENSITIVE });

  map.set("screen_status", {
    tier: PolicyTier.READ_ONLY,
    defaultAllow: true,
    requiresApproval: false,
  });

  return map;
}
