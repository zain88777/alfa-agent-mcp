import { LLMClient } from "../llm/llmClient.js";
import { AgentRole } from "./agentTypes.js";

export class BaseAgent {
  private llm = new LLMClient();

  constructor(
    private role: AgentRole,
    private systemPrompt: string
  ) {}

  async run(input: {
    task: string;
    context?: string;
    tools?: string[];
  }) {
    const prompt = `
Role: ${this.role}

${this.systemPrompt}

Task:
${input.task}

Context:
${input.context || "none"}

Available tools:
${(input.tools || []).join(", ")}

Return clear JSON:
{
  "summary": "",
  "nextAction": "",
  "tool": "",
  "input": {}
}
`;

    const res = await this.llm.generate({ prompt });

    return {
      role: this.role,
      raw: res.text
    };
  }
}
