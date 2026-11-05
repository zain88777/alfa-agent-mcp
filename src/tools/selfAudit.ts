import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const ROOT = getWorkspaceRoot();
const IGNORED = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
const FLAGS = [
  { name: "TODO", regex: /\bTODO\b/i },
  { name: "FIXME", regex: /\bFIXME\b/i },
  { name: "HACK", regex: /\bHACK\b/i },
  { name: "any_type", regex: /:\s*any\b|\bas\s+any\b/ },
  { name: "console_log", regex: /\bconsole\.log\(/ },
  { name: "empty_catch", regex: /catch\s*\([^)]*\)?\s*{\s*}/ },
  { name: "eval", regex: /\beval\(/ },
  { name: "exec", regex: /\bexec\(/ }
];

async function walk(dir: string, output: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED.has(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walk(full, output);
      continue;
    }

    if (!entry.isFile()) continue;

    try {
      const text = await fs.readFile(full, "utf-8");
      text.split(/\r?\n/).forEach((line, index) => {
        for (const flag of FLAGS) {
          if (flag.regex.test(line)) {
            output.push(`${flag.name} | ${path.relative(ROOT, full)}:${index + 1}: ${line.trim()}`);
          }
        }
      });
    } catch {}
  }
}

export async function selfAuditToolHandler() {
  const output: string[] = [];
  await walk(ROOT, output);

  return {
    content: [
      {
        type: "text" as const,
        text: output.length ? output.join("\n") : "Self audit passed. No obvious flags found."
      }
    ]
  };
}

