import ts from "typescript";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";
import { createAstProgram } from "./astProject.js";

const ROOT = getWorkspaceRoot();

export function findReferences(symbolName: string) {
  const program = createAstProgram();
  const results: Array<{ file: string; line: number; column: number }> = [];

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.fileName.includes("node_modules")) continue;

    function visit(node: ts.Node) {
      if (ts.isIdentifier(node) && node.text === symbolName) {
        const { line, character } =
          sourceFile.getLineAndCharacterOfPosition(node.getStart());

        results.push({
          file: path.relative(ROOT, sourceFile.fileName),
          line: line + 1,
          column: character + 1
        });
      }

      ts.forEachChild(node, visit);
    }

    ts.forEachChild(sourceFile, visit);
  }

  return results;
}

