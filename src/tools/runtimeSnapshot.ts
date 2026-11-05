import { z } from "zod";
import { ToolRegistry } from "../core/toolRegistry.js";
import { buildRuntimeSnapshot } from "../core/runtimeSnapshot.js";

export const runtimeSnapshotSchema = z.object({}).strict();

export async function runtimeSnapshotToolHandler(input: unknown, registry?: ToolRegistry) {
  void input;
  if (!registry) {
    throw new Error("runtime_snapshot requires registry context");
  }
  return buildRuntimeSnapshot(registry);
}
