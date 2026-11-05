import { initSystem } from "../core/initSystem.js";
import { SmartAgent } from "../engine/smartAgent.js";
import { scoreConfidence } from "../engine/confidence.js";

export async function intelligentRunToolHandler(input: {
  goal: string;
}) {
  const { registry } = initSystem();

  const agent = new SmartAgent(registry);
  const result = await agent.run(input.goal);

  const confidence = scoreConfidence(result.history || []);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ ...result, confidence }, null, 2)
      }
    ]
  };
}
