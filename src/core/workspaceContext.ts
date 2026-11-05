import path from "path";
import { loadRuntimeConfig } from "./runtimeConfig.js";

export function getWorkspaceRoot(): string {
  return loadRuntimeConfig().workspaceRoot;
}

export function getWorkspaceStateDir(): string {
  return path.resolve(getWorkspaceRoot(), ".alfa-agent");
}
