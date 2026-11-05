import { initSystem } from "../core/initSystem.js";
import { PlanAgent } from "../engine/planAgent.js";
import { executePlan } from "../engine/executePlan.js";

export async function planExecuteToolHandler(input: {
  goal: string;
  budget?: {
    maxTokensPerExecution?: number;
    maxCostUsdPerExecution?: number;
    maxToolCallsPerExecution?: number;
  };
}) {
  const { registry } = initSystem();

  const planner = new PlanAgent();
  const plan = await planner.createPlan(input.goal);

  const result = await executePlan(registry, plan, undefined, undefined, 0, undefined, input.budget);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ plan, result }, null, 2)
      }
    ]
  };
}
