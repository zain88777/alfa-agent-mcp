import { initSystem } from "../core/initSystem.js";
import { AutoLoopAgent } from "../engine/autoLoopAgent.js";

export async function autoAgentRunToolHandler(input: {
  goal: string;
}) {
  const { registry } = initSystem();

  const agent = new AutoLoopAgent(registry);

  const result = await agent.run(input.goal);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
}
