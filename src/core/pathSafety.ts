/**
 * Safe path normalization utilities to prevent directory traversal and unsafe paths.
 *
 * All file-mutating and file-reading tools MUST use this module instead of
 * rolling their own `startsWith`-based checks, which are vulnerable to
 * sibling-base bypass attacks.
 *
 * Security guarantees:
 * - Blocks directory traversal (`..`) via `path.relative()` comparison
 * - Blocks sibling-base bypass (e.g. C:\workspace2 when base is C:\workspace)
 * - Blocks UNC paths on Windows (`\\server\share`)
 * - Blocks symlink escapes into outside-workspace directories
 * - Blocks access to known system directories
 * - Enforces max path length
 */

import path from "path";
import fs from "fs";
import { loadRuntimeConfig } from "./runtimeConfig.js";
import { globalObservability } from "./observability.js";

/**
 * Configuration for path safety
 */
export interface PathSafetyConfig {
  allowedBase: string;
  disallowedPatterns?: RegExp[];
  maxPathLength?: number;
  /** Whether to reject symlinks pointing outside the workspace (default: true) */
  rejectSymlinkEscapes?: boolean;
  /** Whether to reject UNC/network paths on Windows (default: true) */
  rejectUncPaths?: boolean;
}

/**
 * Sensitive system directories that should never be writable
 */
const SYSTEM_DIR_PATTERNS = [
  /^\/etc\//i,
  /^\/System/i,
  /^\/dev\//i,
  /^\/proc\//i,
  /^\/sys\//i,
  /^\/boot\//i,
  /^\/sbin\//i,
  /^\/bin\//i,
  /^\/usr\/sbin\//i,
  /^\/usr\/bin\//i,
  /^[A-Z]:\\Windows\\/i,
  /^[A-Z]:\\Windows$/i,
  /^[A-Z]:\\System32\\/i,
  /^[A-Z]:\\Program Files\\/i,
  /^[A-Z]:\\Program Files \(x86\)\\/i,
  /^[A-Z]:\\Users\\[^\\]+\\AppData\\Roaming\\npm\\/i,
];

/**
 * Default path safety configuration
 */
function getDefaultConfig(): PathSafetyConfig {
  return {
    allowedBase: loadRuntimeConfig().workspaceRoot,
    maxPathLength: 4096,
    disallowedPatterns: SYSTEM_DIR_PATTERNS,
    rejectSymlinkEscapes: true,
    rejectUncPaths: true,
  };
}

/**
 * Check if a path is a UNC/network path on Windows.
 * UNC paths start with `\\` and refer to network shares.
 */
function isUncPath(p: string): boolean {
  if (process.platform !== "win32") return false;
  // UNC paths start with double backslash (e.g. \\server\share)
  // But NOT paths like \\?\ which are local device paths
  return p.startsWith("\\\\") && !p.startsWith("\\\\?\\");
}

/**
 * Resolve a symlink and verify it stays within the allowed base.
 * Throws if the symlink points outside the workspace.
 */
function checkSymlinkSafety(resolvedPath: string, resolvedBase: string): void {
  try {
    const stat = fs.lstatSync(resolvedPath);
    if (stat.isSymbolicLink()) {
      const realPath = fs.realpathSync(resolvedPath);
      const relative = path.relative(resolvedBase, realPath);
      if (relative.startsWith("..")) {
        throw new Error(
          "Access denied: symlink points outside allowed workspace"
        );
      }
    }
  } catch (err) {
    // If lstat/realpath fails (e.g. file doesn't exist), that's okay
    // We only care about existing symlinks
    if (err instanceof Error && err.message.includes("Access denied")) {
      throw err;
    }
  }
}

/**
 * Normalize and validate a file path.
 *
 * - Resolves relative paths against `allowedBase`.
 * - Blocks directory traversal (`..`) at the resolved level.
 * - Blocks sibling-base bypass attacks (e.g. path.resolve("C:\\workspace", "C:\\workspace2\\..\\..\\etc")).
 * - Blocks UNC/network paths on Windows (`\\server\share`).
 * - Blocks symlink escapes into outside-workspace directories.
 * - Blocks access to system directories.
 *
 * @throws Error if path is unsafe or invalid
 */
export function normalizeSafePath(
  inputPath: string,
  config: Partial<PathSafetyConfig> = {}
): string {
  const t0 = Date.now();
  let ok = false;
  try {
  const finalConfig = { ...getDefaultConfig(), ...config };

  // Validate input
  if (typeof inputPath !== "string") {
    throw new Error("Path must be a string");
  }

  if (inputPath.length === 0) {
    throw new Error("Path cannot be empty");
  }

  if (inputPath.length > (finalConfig.maxPathLength || 4096)) {
    throw new Error(`Path exceeds maximum length of ${finalConfig.maxPathLength}`);
  }

  // Reject UNC paths
  if (finalConfig.rejectUncPaths !== false && isUncPath(inputPath)) {
    throw new Error("Access denied: UNC/network paths are not allowed");
  }

  const resolvedBase = path.resolve(finalConfig.allowedBase);

  // Handle absolute paths
  if (path.isAbsolute(inputPath)) {
    const absolutePath = path.resolve(inputPath);
    const baseParts = resolvedBase.split(path.sep);
    const inputParts = absolutePath.split(path.sep);

    // Windows: check drive letter matches
    if (process.platform === "win32" && baseParts[0]?.toLowerCase() !== inputParts[0]?.toLowerCase()) {
      throw new Error("Access denied: path on different drive than workspace root");
    }

    const resolved = absolutePath;
    const relative = path.relative(resolvedBase, resolved);
    if (relative.startsWith("..")) {
      throw new Error("Access denied: path is outside allowed workspace");
    }

    // Check disallowed patterns
    if (finalConfig.disallowedPatterns) {
      for (const pattern of finalConfig.disallowedPatterns) {
        if (pattern.test(resolved)) {
          throw new Error("Access to this path is not allowed");
        }
      }
    }

    // Check symlink safety
    if (finalConfig.rejectSymlinkEscapes !== false) {
      checkSymlinkSafety(resolved, resolvedBase);
    }

    ok = true;
    return resolved;
  }

  // Strip leading "./" or ".\" for cleaner resolution
  const cleanInput = inputPath.replace(/^[.][\\/]/, "");

  // Normalize path separators
  const normalized = path.normalize(cleanInput);

  // Resolve relative to allowed base
  const resolved = path.resolve(resolvedBase, normalized);

  // CRITICAL: Verify resolved path is within allowed base
  // This catches both `..` traversal and sibling-path attacks
  const relativePath = path.relative(resolvedBase, resolved);
  if (relativePath.startsWith("..")) {
    throw new Error("Access denied: path is outside allowed workspace");
  }

  // Check disallowed patterns (system directories, etc.)
  if (finalConfig.disallowedPatterns) {
    for (const pattern of finalConfig.disallowedPatterns) {
      if (pattern.test(resolved)) {
        throw new Error("Access to this path is not allowed");
      }
    }
  }

  // Check symlink safety
  if (finalConfig.rejectSymlinkEscapes !== false) {
    checkSymlinkSafety(resolved, resolvedBase);
  }

  ok = true;
  return resolved;
  } finally {
    globalObservability.recordPathSafetyCheck(Date.now() - t0, ok);
  }
}

/**
 * Validate multiple paths at once. Returns array of safe resolved paths.
 */
export function validatePaths(
  paths: string[],
  config?: Partial<PathSafetyConfig>
): string[] {
  return paths.map(p => normalizeSafePath(p, config));
}

/**
 * Check if a path is safe without throwing.
 * Returns `true` if path is within allowed base, `false` otherwise.
 */
export function isSafePath(
  inputPath: string,
  config?: Partial<PathSafetyConfig>
): boolean {
  try {
    normalizeSafePath(inputPath, config);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get a safe, relative path for display/logging purposes.
 * Returns `[unsafe path]` if path cannot be resolved safely.
 */
export function getDisplayPath(
  inputPath: string,
  config: Partial<PathSafetyConfig> = {}
): string {
  try {
    const finalConfig = { ...getDefaultConfig(), ...config };
    const resolved = normalizeSafePath(inputPath, config);
    return path.relative(finalConfig.allowedBase, resolved) || ".";
  } catch {
    return "[unsafe path]";
  }
}
