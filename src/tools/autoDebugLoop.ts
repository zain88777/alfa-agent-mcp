import { initSystem } from "../core/initSystem.js";

export async function autoDebugLoopToolHandler(input: {
  command?: string;
  goal?: string;
  maxRounds?: number;
}) {
  const { registry } = initSystem();

  const command = input.command || "npm run build";
  const maxRounds = input.maxRounds ?? 3;
  const history: unknown[] = [];

  for (let round = 1; round <= maxRounds; round++) {
    const runResult = await registry.execute("powershell_run", {
      command,
      timeoutMs: 60000
    });

    history.push({
      round,
      action: "run",
      result: runResult
    });

    const resultText = JSON.stringify(runResult);

    if (resultText.includes('"ok": true')) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                ok: true,
                message: "Command passed.",
                command,
                rounds: round,
                history
              },
              null,
              2
            )
          }
        ]
      };
    }

    const fixGoal =
      input.goal ||
      `Fix the project error from this command output, then make the project build pass. Command: ${command}. Output: ${resultText}`;

    const fixResult = await registry.execute("smart_agent_run", {
      goal: fixGoal
    });

    history.push({
      round,
      action: "smart_fix",
      result: fixResult
    });
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ok: false,
            message: "Auto debug loop reached max rounds.",
            command,
            maxRounds,
            history
          },
          null,
          2
        )
      }
    ]
  };
}