import { ToolRegistry } from "../core/toolRegistry.js";
import { LLMClient } from "../llm/llmClient.js";
import { buildPrompt } from "../llm/promptBuilder.js";

type StepResult = {
  action: string;
  input: unknown;
  output: unknown;
  error?: string;
};
type AgentAction = { action: string; input?: unknown; result?: string };

export class AutoLoopAgent {
  private llm = new LLMClient();
  private maxSteps = 8;

  constructor(private registry: ToolRegistry) {}

  async run(goal: string) {
    const history: StepResult[] = [];

    for (let step = 0; step < this.maxSteps; step++) {
      const tools = this.registry.list();

      const context = history
        .map(
          (h, i) =>
            `Step ${i + 1}:\nAction: ${h.action}\nOutput: ${JSON.stringify(
              h.output
            )}\nError: ${h.error || "none"}`
        )
        .join("\n\n");

      const prompt = buildPrompt({
        goal,
        context,
        tools
      });

      const res = await this.llm.generate({ prompt });

      let action: AgentAction;

      try {
        action = JSON.parse(res.text);
      } catch {
        return {
          error: "LLM invalid JSON",
          raw: res.text,
          history
        };
      }

      if (action.action === "finish") {
        return {
          goal,
          history,
          result: action.result || "Completed"
        };
      }

      if (!this.registry.has(action.action)) {
        history.push({
          action: action.action,
          input: action.input,
          output: null,
          error: "Unknown tool"
        });
        continue;
      }

      try {
        const output = await this.registry.execute(
          action.action,
          action.input || {}
        );

        history.push({
          action: action.action,
          input: action.input,
          output
        });
      } catch (e: unknown) {
        history.push({
          action: action.action,
          input: action.input,
          output: null,
          error: e instanceof Error ? e.message : String(e)
        });
      }
    }

    return {
      goal,
      history,
      result: "Max steps reached"
    };
  }
}
