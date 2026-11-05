import { initSystem } from "../core/initSystem.js";
import { SmartAgent } from "../engine/smartAgent.js";

export async function smartAgentRunToolHandler(input: {
  goal: string;
}) {
  const { registry } = initSystem();
  const agent = new SmartAgent(registry);
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
