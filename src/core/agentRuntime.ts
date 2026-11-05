import { ToolRegistry } from "./toolRegistry.js";

export class AgentRuntime {
  constructor(private registry: ToolRegistry) {}

  async run(goal: string) {
    const steps = [
      { tool: "project_summary", input: {} },
      { tool: "search_files", input: { query: "error" } }
    ];

    const results = [];

    for (const step of steps) {
      try {
        const res = await this.registry.execute(step.tool, step.input);
        results.push({ step, res });
      } catch (e: unknown) {
        results.push({ step, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return { goal, steps, results };
  }
}
