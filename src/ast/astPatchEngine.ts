import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";
import ts from "typescript";

const ROOT = getWorkspaceRoot();

function safe(filePath: string): string {
  const resolved = path.resolve(ROOT, filePath);

  if (!resolved.startsWith(ROOT)) {
    throw new Error("Access denied");
  }

  return resolved;
}

function getNodeName(node: ts.Node): string | null {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)) &&
    node.name
  ) {
    return node.name.text;
  }

  if (ts.isVariableStatement(node)) {
    const declaration = node.declarationList.declarations[0];

    if (declaration && ts.isIdentifier(declaration.name)) {
      return declaration.name.text;
    }
  }

  return null;
}

export async function astPatchNode(input: {
  filePath: string;
  symbolName: string;
  replacementCode: string;
}) {
  const fullPath = safe(input.filePath);
  const original = await fs.readFile(fullPath, "utf-8");

  const sourceFile = ts.createSourceFile(
    fullPath,
    original,
    ts.ScriptTarget.Latest,
    true
  );

  let targetNode: ts.Node | null = null;

  function visit(node: ts.Node): void {
    if (targetNode) return;

    const nodeName = getNodeName(node);

    if (nodeName === input.symbolName) {
      targetNode = node;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (!targetNode) {
    throw new Error(`Symbol not found: ${input.symbolName}`);
  }

  const patchTarget = targetNode as unknown as ts.Node;
const start = patchTarget.getFullStart();
  const end = patchTarget.getEnd();

  const updated =
    original.slice(0, start) +
    "\n" +
    input.replacementCode.trim() +
    "\n" +
    original.slice(end);

  const backupDir = path.resolve(ROOT, ".alfa-agent", "ast-backups");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(
    backupDir,
    `${input.filePath.replace(/[\\/]/g, "__")}.${stamp}.bak`
  );

  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(backupPath, original, "utf-8");
  await fs.writeFile(fullPath, updated, "utf-8");

  return {
    patched: input.symbolName,
    file: input.filePath,
    backup: path.relative(ROOT, backupPath)
  };
}



