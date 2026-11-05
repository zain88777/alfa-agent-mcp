import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const ROOT = getWorkspaceRoot();
const IGNORED = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
const EXTS = new Set([".ts", ".tsx"]);

async function walk(dir: string, files: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED.has(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) await walk(full, files);
    else if (entry.isFile() && EXTS.has(path.extname(entry.name))) files.push(full);
  }
}

export async function tsSymbolIndexToolHandler(input: { query?: string }) {
  const files: string[] = [];
  const symbols: Array<{ file: string; line: number; kind: string; name: string }> = [];

  await walk(ROOT, files);

  for (const file of files) {
    const text = await fs.readFile(file, "utf-8");
    const lines = text.split(/\r?\n/);

    lines.forEach((line, index) => {
      const patterns = [
        { kind: "function", regex: /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/ },
        { kind: "class", regex: /\b(?:export\s+)?class\s+([A-Za-z0-9_]+)/ },
        { kind: "interface", regex: /\b(?:export\s+)?interface\s+([A-Za-z0-9_]+)/ },
        { kind: "type", regex: /\b(?:export\s+)?type\s+([A-Za-z0-9_]+)/ },
        { kind: "const", regex: /\b(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=/ }
      ];

      for (const pattern of patterns) {
        const match = line.match(pattern.regex);
        if (match) {
          symbols.push({
            file: path.relative(ROOT, file),
            line: index + 1,
            kind: pattern.kind,
            name: match[1]
          });
        }
      }
    });
  }

  const filtered = input.query
    ? symbols.filter((item) => item.name.toLowerCase().includes(input.query!.toLowerCase()))
    : symbols;

  return {
    content: [{ type: "text" as const, text: JSON.stringify(filtered, null, 2) }]
  };
}

