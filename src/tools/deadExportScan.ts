import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";

const ROOT = getWorkspaceRoot();
const IGNORED = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
const EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);

async function walk(dir: string, files: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED.has(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) await walk(full, files);
    else if (entry.isFile() && EXTS.has(path.extname(entry.name))) files.push(full);
  }
}

export async function deadExportScanToolHandler() {
  const files: string[] = [];
  const exportsFound: Array<{ name: string; file: string; line: number }> = [];
  const allText: string[] = [];

  await walk(ROOT, files);

  for (const file of files) {
    const text = await fs.readFile(file, "utf-8");
    allText.push(text);

    text.split(/\r?\n/).forEach((line, index) => {
      const match = line.match(/\bexport\s+(?:async\s+)?(?:function|const|class|type|interface)\s+([A-Za-z0-9_]+)/);
      if (match) {
        exportsFound.push({ name: match[1], file: path.relative(ROOT, file), line: index + 1 });
      }
    });
  }

  const whole = allText.join("\n");
  const maybeDead = exportsFound.filter((item) => {
    const count = (whole.match(new RegExp(`\\b${item.name}\\b`, "g")) || []).length;
    return count <= 1;
  });

  return {
    content: [{ type: "text" as const, text: JSON.stringify(maybeDead, null, 2) }]
  };
}

