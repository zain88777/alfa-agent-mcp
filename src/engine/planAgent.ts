import { LLMClient } from "../llm/llmClient.js";
import { extractJson } from "../llm/json.js";

export class PlanAgent {
  private llm = new LLMClient();

  async createPlan(goal: string) {
    const prompt = `
You are a senior software architect.

Goal:
${goal}

Break this into a SAFE step-by-step execution plan.

Return JSON:
{
  "steps": [
    { "tool": "", "reason": "" }
  ]
}
`;

    const res = await this.llm.generate({ prompt });
    return extractJson(res.text);
  }
}
