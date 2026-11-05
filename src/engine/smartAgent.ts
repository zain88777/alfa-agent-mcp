import fs from "fs/promises";
import { getWorkspaceRoot } from "../core/workspaceContext.js";
import path from "path";
import { ToolRegistry } from "../core/toolRegistry.js";
import { LLMClient } from "../llm/llmClient.js";
import { extractJson } from "../llm/json.js";
import { buildSmartAgentPrompt } from "../llm/smartPrompt.js";

const MEMORY_FILE = path.resolve(getWorkspaceRoot(), ".alfa-agent", "memory.json");

async function readMemory(): Promise<string> {
  try {
    return await fs.readFile(MEMORY_FILE, "utf-8");
  } catch {
    return "{}";
  }
}

export class SmartAgent {
  private llm = new LLMClient();
  private maxSteps = 12;

  constructor(private registry: ToolRegistry) {}

  async run(goal: string) {
    const history: Array<Record<string, unknown>> = [];

    for (let i = 0; i < this.maxSteps; i++) {
      const prompt = buildSmartAgentPrompt({
        goal,
        tools: this.registry.list(),
        memory: await readMemory(),
        history: JSON.stringify(history.slice(-6), null, 2)
      });

      const llm = await this.llm.generate({ prompt });
      let decision: { type?: string; tool?: string; input?: unknown; summary?: string; confidence?: number };

      try {
        const parsed = extractJson(llm.text);
        decision = (typeof parsed === "object" && parsed !== null ? parsed : {}) as {
          type?: string;
          tool?: string;
          input?: unknown;
          summary?: string;
          confidence?: number;
        };
      } catch (error: unknown) {
        history.push({
          step: i + 1,
          error: error instanceof Error ? error.message : String(error),
          raw: llm.text
        });
        continue;
      }

      if (decision.type === "finish") {
        return {
          goal,
          finished: true,
          summary: decision.summary || "",
          confidence: decision.confidence ?? 0,
          history
        };
      }

      if (decision.type !== "tool" || !decision.tool) {
        history.push({
          step: i + 1,
          error: "Invalid decision shape",
          decision
        });
        continue;
      }

      if (!this.registry.has(decision.tool)) {
        history.push({
          step: i + 1,
          tool: decision.tool,
          error: "Unknown tool"
        });
        continue;
      }

      try {
        const output = await this.registry.execute(decision.tool, decision.input || {});
        history.push({
          step: i + 1,
          tool: decision.tool,
          input: decision.input || {},
          output
        });
      } catch (error: unknown) {
        history.push({
          step: i + 1,
          tool: decision.tool,
          input: decision.input || {},
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      goal,
      finished: false,
      summary: "Max smart-agent steps reached.",
      history
    };
  }
}


