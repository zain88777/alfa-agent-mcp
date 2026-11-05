import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const allowlistPath = path.resolve(__dirname, "env-read-allowlist.json");
const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
const allowedPaths = new Set(allowlist.map((a) => a.path));

const EXTENSIONS = [".ts", ".js", ".mjs", ".cjs", ".mts", ".cts"];
const SCAN_DIRS = ["src", "scripts", "test"];

const ENV_PATTERN = /process\.env\.([A-Z0-9_]+)/g;

function isTestFile(file) {
  const normalized = file.replace(/\\/g, "/");
  return normalized.includes("/test/") || normalized.includes("\\test\\");
}

function suggestReplacement(file, envKey) {
  if (file.includes("runtimeConfig.ts")) return "Allowed: keep centralized loader";
  if (envKey === "ALFA_WORKSPACE_ROOT") return "Use getWorkspaceRoot() from src/core/workspaceContext.ts";
  if (envKey === "ALFA_DEBUG") return "Use loadRuntimeConfig().debugMode";
  if (envKey?.startsWith("LLM_")) return "Use buildProviderConfig()/loadRuntimeConfig()";
  return "Route through loadRuntimeConfig() or add documented allowlist exception";
}

function getAllFiles(dir) {
  const results = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          results.push(...getAllFiles(fullPath));
        } else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) {
          results.push(fullPath.replace(/\\/g, "/"));
        }
      } catch {
      }
    }
  } catch {
  }
  return results;
}

const rows = [];
for (const scanDir of SCAN_DIRS) {
  const fullDir = path.join(rootDir, scanDir);
  const files = getAllFiles(fullDir);
  for (const file of files) {
    try {
      const content = readFileSync(file, "utf8");
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let match;
        const re = new RegExp(ENV_PATTERN.source, "g");
        while ((match = re.exec(line)) !== null) {
          const envKey = match[1];
          const isTest = isTestFile(file);
          const approved = isTest || allowedPaths.has(file);
          rows.push({
            file,
            line: i + 1,
            envKey,
            approved,
            suggestion: suggestReplacement(file, envKey),
            source: line.trim(),
          });
        }
      }
    } catch {
    }
  }
}

const debt = rows.filter((r) => !r.approved);

console.log(JSON.stringify({
  count: debt.length,
  approvedCount: rows.length - debt.length,
  allowlist: allowlist,
  debt,
}, null, 2));

process.exit(0);