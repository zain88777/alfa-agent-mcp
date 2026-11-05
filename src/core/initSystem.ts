import { ToolRegistry } from "./toolRegistry.js";
import { createRegistry } from "./toolLoader.js";
import { AgentRuntime } from "./agentRuntime.js";
import { restoreRuntimeState } from "./runtimePersistence.js";

export function initSystem() {
  const registry: ToolRegistry = createRegistry();
  console.error(`[AlfaDev][Startup] approval engine initialized for ${registry.instanceId}`);
  void restoreRuntimeState(registry).catch(() => {
    // Startup restore failures are non-fatal by design.
  });

  const runtime = new AgentRuntime(registry);

  return { registry, runtime };
}
