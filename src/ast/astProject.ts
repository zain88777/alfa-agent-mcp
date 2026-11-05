import ts from "typescript";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import fs from "fs";
import path from "path";

const ROOT = getWorkspaceRoot();

export function createAstProgram() {
  const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, "tsconfig.json");

  if (!configPath) {
    throw new Error("tsconfig.json not found");
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);

  if (configFile.error) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath)
  );

  return ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options
  });
}

export function getSourceFiles() {
  const program = createAstProgram();

  return program
    .getSourceFiles()
    .filter((file) => !file.fileName.includes("node_modules"))
    .map((file) => ({
      fileName: path.relative(ROOT, file.fileName),
      text: fs.readFileSync(file.fileName, "utf-8")
    }));
}


