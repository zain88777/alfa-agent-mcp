import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";
import { findReferences } from "./references.js";

const ROOT = getWorkspaceRoot();

export async function safeRename(symbol: string, newName: string) {
  if (!symbol || !newName) {
    throw new Error("symbol and newName are required");
  }

  const refs = findReferences(symbol);
  const files = [...new Set(refs.map((ref) => ref.file))];
  const changedFiles: string[] = [];

  for (const file of files) {
    const fullPath = path.resolve(ROOT, file);
    const original = await fs.readFile(fullPath, "utf-8");

    const updated = original.replace(
      new RegExp(`\\b${symbol}\\b`, "g"),
      newName
    );

    if (updated !== original) {
      await fs.writeFile(fullPath, updated, "utf-8");
      changedFiles.push(file);
    }
  }

  return {
    renamed: symbol,
    to: newName,
    changedFiles
  };
}

