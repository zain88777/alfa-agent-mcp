type ToolCall = {
  tool: string;
  input: Record<string, unknown>;
};

export class AgentCore {
  history: string[] = [];

  async think(goal: string): Promise<string> {
    this.history.push(goal);

    if (goal.includes("error")) return "run_debug";
    if (goal.includes("fix")) return "apply_patch";
    if (goal.includes("scan")) return "search_files";

    return "analyze_project";
  }

  async plan(_goal: string): Promise<ToolCall[]> {
    return [
      { tool: "project_summary", input: {} },
      { tool: "typecheck", input: {} },
      { tool: "self_audit", input: {} }
    ];
  }
}
