import { initSystem } from "../core/initSystem.js";

export async function agentExecuteToolHandler(input: {
  goal: string;
}) {
  const { runtime } = initSystem();

  const result = await runtime.run(input.goal);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
}
