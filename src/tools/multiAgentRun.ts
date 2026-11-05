import { initSystem } from "../core/initSystem.js";
import { MultiAgentRuntime } from "../agents/multiAgentRuntime.js";
import { AgentRole } from "../agents/agentTypes.js";

export async function multiAgentRunToolHandler(input: {
  task: string;
  flow?: AgentRole[];
}) {
  const { registry } = initSystem();
  const runtime = new MultiAgentRuntime(registry);

  const result = await runtime.run(input.task, input.flow);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
}
