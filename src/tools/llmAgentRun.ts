import { initSystem } from "../core/initSystem.js";
import { LLMAgent } from "../engine/llmAgent.js";

export async function llmAgentRunToolHandler(input: {
  goal: string;
}) {
  const { registry } = initSystem();

  const agent = new LLMAgent(registry);

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
