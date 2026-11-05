import { runAgent } from "../engine/agentLoop.js";
import { ToolRegistry } from "../core/toolRegistry.js";

/**
 * Agent run tool that uses ToolRegistry as the single execution path.
 * Registry is injected via closure from toolLoader.
 */
export async function agentRunToolHandler(input: {
  goal: string;
  registry?: ToolRegistry;
}) {
  if (!input.registry) {
    throw new Error("Registry instance is required for agent execution");
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          await runAgent(input.goal, input.registry),
          null,
          2
        )
      }
    ]
  };
}
