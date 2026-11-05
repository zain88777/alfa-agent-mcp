import { LLMClient } from "../llm/llmClient.js";
import { buildPrompt } from "../llm/promptBuilder.js";
import { ToolRegistry } from "../core/toolRegistry.js";

export class LLMAgent {
  constructor(
    private registry: ToolRegistry,
    private llm = new LLMClient()
  ) {}

  async run(goal: string) {
    const tools = this.registry.list();

    const prompt = buildPrompt({
      goal,
      tools
    });

    const res = await this.llm.generate({ prompt });

    let action: { action: string; input?: unknown };

    try {
      action = JSON.parse(res.text);
    } catch {
      return { error: "Invalid LLM response", raw: res.text };
    }

    if (!this.registry.has(action.action)) {
      return { error: "Unknown tool", action };
    }

    const result = await this.registry.execute(
      action.action,
      action.input || {}
    );

    return {
      goal,
      action,
      result
    };
  }
}
