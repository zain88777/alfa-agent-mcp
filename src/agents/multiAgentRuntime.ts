import { ToolRegistry } from "../core/toolRegistry.js";
import { createAgent } from "./agentFactory.js";
import { AgentMessage, AgentRole } from "./agentTypes.js";

const DEFAULT_FLOW: AgentRole[] = [
  "planner",
  "coder",
  "tester",
  "reviewer",
  "security",
  "finalizer"
];

export class MultiAgentRuntime {
  constructor(private registry: ToolRegistry) {}

  async run(task: string, flow: AgentRole[] = DEFAULT_FLOW) {
    const history: AgentMessage[] = [];
    const tools = this.registry.list();

    for (const role of flow) {
      const agent = createAgent(role);

      const context = history
        .map((m) => `${m.role}: ${m.output || m.error || ""}`)
        .join("\n\n");

      try {
        const result = await agent.run({
          task,
          context,
          tools
        });

        history.push({
          role,
          task,
          output: result.raw
        });
      } catch (error: unknown) {
        history.push({
          role,
          task,
          error: error instanceof Error ? error.message : "Unknown agent error"
        });
      }
    }

    return {
      task,
      flow,
      history
    };
  }
}
