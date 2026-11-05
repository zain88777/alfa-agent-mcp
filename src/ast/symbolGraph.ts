import ts from "typescript";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";
import { createAstProgram } from "./astProject.js";

const ROOT = getWorkspaceRoot();

export function buildSymbolGraph() {
  const program = createAstProgram();
  const checker = program.getTypeChecker();

  const graph: Array<{ name: string; kind: string; file: string; line: number; column: number }> = [];

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.fileName.includes("node_modules")) continue;

    function visit(node: ts.Node) {
      let symbol: ts.Symbol | undefined;

      const namedNode = node as ts.Node & { name?: ts.Node };
      if (namedNode.name) {
        symbol = checker.getSymbolAtLocation(namedNode.name);
      }

      if (symbol) {
        const name = symbol.getName();

        const { line, character } =
          sourceFile.getLineAndCharacterOfPosition(node.getStart());

        graph.push({
          name,
          kind: ts.SyntaxKind[node.kind],
          file: path.relative(ROOT, sourceFile.fileName),
          line: line + 1,
          column: character + 1
        });
      }

      ts.forEachChild(node, visit);
    }

    ts.forEachChild(sourceFile, visit);
  }

  return graph;
}

