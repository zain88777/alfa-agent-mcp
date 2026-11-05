/**
 * Protected paths policy — safeguards high-value project files from accidental mutation.
 *
 * Protected paths include:
 * - Environment files (.env, .env.*) — contain secrets
 * - Version control metadata (.git/) — project history
 * - CI/CD workflow files (.github/workflows/) — deployment pipelines
 * - Lock files — dependency integrity
 * - Runtime/CI config files — project configuration
 *
 * Writes/deletes/moves/patches touching protected paths must require
 * DANGEROUS or SYSTEM_SENSITIVE approval, or be denied by default.
 *
 * This module is path-safe: it never leaks raw absolute paths in errors.
 */

import { loadRuntimeConfig } from "./runtimeConfig.js";
import { ErrorCode, ToolExecutionErrorClass } from "./errorResponse.js";
import type { ToolExecutionContext } from "./executionContext.js";
import { PolicyTier } from "./policyEngine.js";
import { globalObservability } from "./observability.js";

const DANGEROUS_OR_SENSITIVE = [PolicyTier.DANGEROUS, PolicyTier.SYSTEM_SENSITIVE];

/**
 * Patterns for protected paths.
 * Order matters — more specific patterns first.
 */
const PROTECTED_PATH_PATTERNS: Array<{
  pattern: (resolvedPath: string, workspaceRoot: string) => boolean;
  name: string;
  requiresApproval: boolean;
}> = [
  {
    name: ".env files",
    requiresApproval: true,
    pattern: (resolved) => {
      const normalized = resolved.replace(/\\/g, "/");
      return normalized.endsWith("/.env") || normalized.endsWith(".env.local") ||
             normalized.endsWith(".env.development") || normalized.endsWith(".env.production") ||
             normalized.endsWith(".env.test") || normalized.includes("/.env.") || normalized.endsWith(".envrc");
    },
  },
  {
    name: ".git directory",
    requiresApproval: true,
    pattern: (resolved, base) => {
      const normalized = resolved.replace(/\\/g, "/");
      const baseNorm = base.replace(/\\/g, "/");
      const gitDir = baseNorm + "/.git";
      return normalized === gitDir || normalized.startsWith(gitDir + "/");
    },
  },
  {
    name: ".github/workflows",
    requiresApproval: true,
    pattern: (resolved, base) => {
      const normalized = resolved.replace(/\\/g, "/");
      const baseNorm = base.replace(/\\/g, "/");
      const ghDir = baseNorm + "/.github";
      return normalized === ghDir || normalized.startsWith(ghDir + "/");
    },
  },
  {
    name: "package-lock.json",
    requiresApproval: true,
    pattern: (resolved) => {
      const normalized = resolved.replace(/\\/g, "/");
      return normalized.endsWith("/package-lock.json") || normalized.endsWith("\\package-lock.json");
    },
  },
  {
    name: "pnpm-lock.yaml",
    requiresApproval: true,
    pattern: (resolved) => {
      const normalized = resolved.replace(/\\/g, "/");
      return normalized.endsWith("/pnpm-lock.yaml") || normalized.endsWith("\\pnpm-lock.yaml");
    },
  },
  {
    name: "yarn.lock",
    requiresApproval: true,
    pattern: (resolved) => {
      const normalized = resolved.replace(/\\/g, "/");
      return normalized.endsWith("/yarn.lock") || normalized.endsWith("\\yarn.lock");
    },
  },
  {
    name: "CI/CD config",
    requiresApproval: true,
    pattern: (resolved) => {
      const normalized = resolved.replace(/\\/g, "/");
      return normalized.endsWith("/.gitlab-ci.yml") || normalized.endsWith("/.gitlab-ci.yaml") ||
             normalized.endsWith("\\.gitlab-ci.yml") || normalized.endsWith("\\.gitlab-ci.yaml") ||
             normalized.endsWith("/.circleci/config.yml") || normalized.endsWith("\\.circleci\\config.yml") ||
             normalized.endsWith("/.github/dependabot.yml") || normalized.endsWith("\\.github\\dependabot.yml") ||
             normalized.endsWith("/.github/dependabot.yaml") || normalized.endsWith("\\.github\\dependabot.yaml");
    },
  },
  {
    name: "release config",
    requiresApproval: true,
    pattern: (resolved) => {
      const normalized = resolved.replace(/\\/g, "/");
      return normalized.endsWith("/release.config.js") || normalized.endsWith("\\release.config.js") ||
             normalized.endsWith("/.releaserc") || normalized.endsWith("\\.releaserc") ||
             normalized.endsWith("/.releaserc.json") || normalized.endsWith("\\.releaserc.json") ||
             normalized.endsWith("/.github/workflows/release.yml") ||
             normalized.endsWith("/.github/workflows/publish.yml");
    },
  },
];

/**
 * Check if a resolved path is protected.
 * Returns the protection info if protected, undefined otherwise.
 */
export function getProtectedPathInfo(
  resolvedPath: string
): { protected: boolean; name: string; requiresApproval: boolean } | undefined {
  const runtimeConfig = loadRuntimeConfig();
  const workspaceRoot = runtimeConfig.workspaceRoot;

  for (const entry of PROTECTED_PATH_PATTERNS) {
    if (entry.pattern(resolvedPath, workspaceRoot)) {
      return { protected: true, name: entry.name, requiresApproval: entry.requiresApproval };
    }
  }
  return undefined;
}

/**
 * Enforce protected path policy for a mutation operation (write/delete/move/patch).
 * Throws ToolExecutionErrorClass with PATH_DENIED if the path is protected
 * and the execution context does not have DANGEROUS or SYSTEM_SENSITIVE approval.
 *
 * This is the single enforcement point for all protected path checks.
 * The tool should call this BEFORE performing the actual file operation.
 *
 * @param resolvedPath - The resolved (workspace-absolute) path
 * @param toolName - Name of the tool for error context
 * @param context - Optional execution context; if provided, approval tier is checked
 */
export function enforceProtectedPath(
  resolvedPath: string,
  toolName: string,
  context?: ToolExecutionContext
): void {
  const t0 = Date.now();
  let ok = false;
  try {
  const info = getProtectedPathInfo(resolvedPath);
  if (!info) {
    ok = true;
    return;
  }

  if (context?.approval?.isApproved && DANGEROUS_OR_SENSITIVE.includes(context.metadata.policyTier)) {
    ok = true;
    return;
  }

  throw new ToolExecutionErrorClass(
    ErrorCode.PATH_DENIED,
    `Access to protected path '${info.name}' is denied by policy.`,
    {
      tool: toolName,
      retryable: false,
      details: {
        pathType: info.name,
        requiresApproval: info.requiresApproval,
        message: "Protected path policy: mutations to this path require explicit approval (tier: dangerous or system_sensitive).",
      },
    }
  );
  } finally {
    globalObservability.recordProtectedPathCheck(Date.now() - t0, ok);
  }
}

/**
 * Get the protected paths list for documentation/display purposes.
 * Returns safe display names only — no raw paths.
 */
export function getProtectedPathsList(): Array<{ name: string; description: string }> {
  return [
    { name: ".env files", description: "Environment files (.env, .env.*) — contain credentials and secrets" },
    { name: ".git directory", description: "Version control metadata and history" },
    { name: ".github/workflows", description: "CI/CD pipeline definitions" },
    { name: "package-lock.json", description: "npm dependency lock file" },
    { name: "pnpm-lock.yaml", description: "pnpm dependency lock file" },
    { name: "yarn.lock", description: "yarn dependency lock file" },
    { name: "CI/CD config", description: "GitLab CI, CircleCI, Dependabot configuration files" },
    { name: "release config", description: "Semantic release and deployment configuration" },
  ];
}
